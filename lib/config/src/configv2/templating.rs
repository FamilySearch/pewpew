//! Templating-related types. The generic type vars `VD` and `ED` correspond to "Vars Done", meaning
//! that static vars have been inserted, and "Envs Done", meaning that OS Environment variables have been
//! inserted.
//!
//! Rather than redefine nearly identical types multiple times for the same structure before and
//! after var processing, this module uses conditional enums to manage state, as well as which
//! template sources are allowed.
//!
//! Read here for more info: <https://rreverser.com/conditional-enum-variants-in-rust/>
//!
//! For example: `Template<_, EnvsOnly>` cannot be instantiated in the PreVars variant, because the
//! associated type is False.

use super::{
    error::{CreateExprError, EnvsError, EvalExprError, IntoStreamError, MissingEnvVar, VarsError},
    scripting::EvalExpr,
    PropagateVars,
};
use derivative::Derivative;
use ether::{Either, Either3};
use futures::{Stream, TryStreamExt};
pub use helpers::*;
use itertools::Itertools;
use log::debug;
use serde::Deserialize;
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    convert::TryFrom,
    error::Error as StdError,
    fmt::{self, Display},
    iter::FromIterator,
    str::FromStr,
    sync::Arc,
};
use thiserror::Error;

mod parser;

pub use parser::Segment;

/// Template type that allows for insertion of environment or static config variables, as well as
/// repeated evaluation with values from the providers.
///
/// The `__dontuse` properties of certain variants are just flags to ensure that that variant
/// cannot be constructed if certain conditions are not met
#[derive(Deserialize, PartialEq, Eq, Derivative, Clone)]
#[derivative(Debug)]
#[serde(try_from = "TemplatedString<T>")]
#[serde(bound(deserialize = ""))]
#[derive(serde::Serialize)]
#[serde(into = "TemplatedString<T>")]
#[serde(bound(serialize = "V: std::fmt::Display + Clone"))]
pub enum Template<
    V: FromStr,
    T: TemplateType,
    VD: Bool, /* = <<T as TemplateType>::VarsAllowed as Bool>::Inverse*/
    ED: Bool = <<T as TemplateType>::EnvsAllowed as Bool>::Inverse,
> where
    <V as FromStr>::Err: StdError + Send + Sync + 'static,
{
    Literal {
        value: V,
    },
    Env {
        template: TemplatedString<T>,
        #[derivative(Debug = "ignore")]
        __dontuse: (T::EnvsAllowed, ED::Inverse),
    },
    #[allow(clippy::type_complexity)]
    PreVars {
        template: TemplatedString<T>,
        /// Determines "next" state after vars propagation, depending on if initial variant needed
        /// provider values or not
        next: fn(TemplatedString<T>) -> Result<Template<V, T, True, True>, super::VarsError>,
        #[derivative(Debug = "ignore")]
        __dontuse: (T::VarsAllowed, VD::Inverse),
    },
    NeedsProviders {
        script: Vec<ExprSegment>,
        #[derivative(Debug = "ignore")]
        __dontuse: (ED, VD, T::ProvAllowed),
    },
}

impl<V: FromStr + std::fmt::Display, T: TemplateType, VD: Bool, ED: Bool>
    From<Template<V, T, VD, ED>> for TemplatedString<T>
where
    <V as FromStr>::Err: StdError + Send + Sync + 'static,
{
    fn from(value: Template<V, T, VD, ED>) -> Self {
        match value {
            Template::Literal { value } => Self(vec![Segment::Raw(value.to_string())]),
            Template::Env {
                template,
                __dontuse,
            } => template,
            Template::PreVars { template, .. } => template,
            // probably won't be needed, as serialization is done with `<VD = False>` templates.
            Template::NeedsProviders { .. } => todo!("TemplatedString FromStr NeedsProviders todo"),
        }
    }
}

/// Segment of an Expression.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExprSegment {
    /// Just a string.
    Str(Arc<str>),
    /// Insert a Provider value as a String.
    ProvDirect(Arc<str>),
    /// Execute the contained JS code, and insert the result into the final String.
    Eval(EvalExpr),
}

#[derive(Debug, Error)]
pub enum TemplateGenError<V: FromStr>
where
    V::Err: StdError + 'static,
{
    #[error("{0}")]
    FromStr(#[source] V::Err),
}

impl<V, T, VD: Bool, ED: Bool> TryFrom<TemplatedString<T>> for Template<V, T, VD, ED>
where
    V: FromStr,
    V::Err: StdError + Send + Sync + 'static,
    T: TemplateType,
{
    type Error = TemplateGenError<V>;

    fn try_from(value: TemplatedString<T>) -> Result<Self, Self::Error> {
        match value.into_literal() {
            Ok(s) => match s.parse::<V>() {
                Ok(v) => Ok(Self::Literal { value: v }),
                Err(e) => Err(TemplateGenError::FromStr(e)),
            },
            Err(template) => {
                if T::EnvsAllowed::VALUE {
                    Ok(Self::Env {
                        template,
                        __dontuse: TryDefault::try_default()
                            .expect("should have already been checked"),
                    })
                } else {
                    Ok(Self::PreVars {
                        template,
                        next: if T::ProvAllowed::VALUE {
                            |s| {
                                let s = s.collapse();
                                match s.clone().try_collect() {
                                    None => Ok(Template::NeedsProviders {
                                        script: s.into_regular().unwrap().into_script()?,
                                        __dontuse: TryDefault::try_default().unwrap(),
                                    }),
                                    Some(s) => s
                                        .parse()
                                        .map_err(|e: <V as FromStr>::Err| {
                                            super::VarsError::InvalidString {
                                                typename: std::any::type_name::<V>(),
                                                from: s,
                                                error: Arc::new(e),
                                            }
                                        })
                                        .map(|v| Template::Literal { value: v }),
                                }
                            }
                        } else {
                            |s| {
                                let s = s.try_collect().unwrap();
                                s.parse()
                                    .map_err(|e: <V as FromStr>::Err| {
                                        super::VarsError::InvalidString {
                                            typename: std::any::type_name::<V>(),
                                            from: s,
                                            error: Arc::new(e),
                                        }
                                    })
                                    .map(|v| Template::Literal { value: v })
                            }
                        },
                        __dontuse: TryDefault::try_default()
                            .expect("should already have been checked"),
                    })
                }
            }
        }
    }
}

impl<T: TemplateType<ProvAllowed = True>> Template<String, T, True, True> {
    /// Converts the Template into a Stream that pulls values from the Providers as needed, and
    /// evaluates the template with those values for each output.
    ///
    /// Used by the Declare into_stream() method.
    pub(crate) fn into_stream<P, Ar, E>(
        self,
        providers: Arc<BTreeMap<Arc<str>, P>>,
    ) -> Result<
        impl Stream<Item = Result<(serde_json::Value, Vec<Ar>), E>> + Send + 'static,
        IntoStreamError,
    >
    where
        P: super::scripting::ProviderStream<Ar, Err = E> + 'static,
        Ar: Clone + Send + Unpin + 'static,
        E: StdError + Send + Clone + Unpin + 'static + From<EvalExprError>,
    {
        debug!(
            "Template into_stream template={:?}, providers={:?}",
            self,
            providers.keys()
        );
        self.into_stream_with(move |p| providers.get(p).map(|p| p.as_stream()))
    }

    /// The `F` parameter is used by a Declare to allow this template to read from a "normal"
    /// provider or a declare entry interchangeably.
    pub(crate) fn into_stream_with<F, Ar, E>(
        self,
        mut provider_get: F,
    ) -> Result<
        impl Stream<Item = Result<(serde_json::Value, Vec<Ar>), E>> + Send + 'static,
        IntoStreamError,
    >
    where
        F: FnMut(
                &str,
            ) -> Option<
                Box<
                    dyn Stream<Item = Result<(serde_json::Value, Vec<Ar>), E>>
                        + Send
                        + Unpin
                        + 'static,
                >,
            > + Clone,
        Ar: Clone + Send + Unpin + 'static,
        E: Clone + Send + Unpin + StdError + 'static + From<EvalExprError>,
    {
        use futures::stream::repeat;
        Ok(match self {
            Self::Literal { value } => {
                debug!(
                    "Template::Literal into_stream_with value='{}', json='{}'",
                    value,
                    serde_json::Value::String(value.clone())
                );
                Either::A(repeat(Ok((serde_json::Value::String(value), vec![]))))
            }
            Self::NeedsProviders { script, .. } => {
                debug!(
                    "Template::NeedsProviders into_stream_with script={:?}",
                    script
                );
                let streams = script
                    .into_iter()
                    .map(|s| match s {
                        ExprSegment::Str(s) => Ok(Either3::A(repeat(Ok((
                            serde_json::Value::String(s.to_string()),
                            vec![],
                        ))))),
                        ExprSegment::ProvDirect(p) => provider_get(&p)
                            .map(Either3::B)
                            .ok_or(IntoStreamError::MissingProvider(p)),
                        ExprSegment::Eval(x) => {
                            x.into_stream_with(provider_get.clone()).map(Either3::C)
                        }
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Either::B(zip_all::zip_all(streams).map_ok(|js| {
                    js.into_iter()
                        .map(|(j, ar)| {
                            match j {
                                serde_json::Value::String(s) => {
                                    // We don't want to stringify the json::Value::String or it will escape out quotes, etc.
                                    // Get the internal string and use it.
                                    debug!("Template into_stream_with zip_all json::string s={}, to_string={}", s, s.to_string());
                                    (s.trim_matches('"').to_owned(), ar)
                                },
                                other => {
                                    debug!("Template into_stream_with zip_all json::other j={}, to_string={}", other, other.to_string());
                                    (other.to_string().trim_matches('"').to_owned(), ar)
                                },
                            }
                        })
                        .reduce(|mut acc, e| {
                            acc.0.push_str(&e.0);
                            acc.1.extend(e.1);
                            acc
                        })
                        .map(|(s, ar)| {
                            // If it's an object we're turning it into a string here
                            (
                                match serde_json::from_str(&s) {
                                    Ok(serde_json::Value::String(s)) => {
                                        log::debug!("Template into_stream_with Using literal string {s:?} as the json value");
                                        serde_json::Value::String(s)
                                    }
                                    Ok(v) => v,
                                    Err(e) => {
                                        log::debug!("Template into_stream_with String {s:?} is not valid JSON ({e}); reusing same string value");
                                        serde_json::Value::String(s)
                                    }
                                },
                                ar,
                            )
                        })
                        .unwrap_or_default()
                }))
            }
            Self::Env { __dontuse, .. } => __dontuse.1.no(),
            Self::PreVars { __dontuse, .. } => __dontuse.1.no(),
        })
    }

    /// Directly evaluate the template by passing in a map of provider name - provider data
    /// key-value pairs.
    pub fn evaluate(&self, data: Cow<'_, serde_json::Value>) -> Result<String, EvalExprError> {
        log::debug!("evaluating template {self:?} with values {data:?}");
        match self {
            Self::Literal { value } => Ok(value.trim_matches('"').to_owned()),
            Self::NeedsProviders { script, __dontuse } => script
                .iter()
                .map(|e| match e {
                    ExprSegment::Eval(x) => x.evaluate(data.clone()),
                    ExprSegment::Str(s) => Ok(s.to_string()),
                    ExprSegment::ProvDirect(p) => data
                        .as_object()
                        .and_then(|o| o.get::<str>(p))
                        .map(|o| match o {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        })
                        .ok_or_else(|| EvalExprError(format!("provider data {p} not found"))),
                })
                .collect(),
            Self::Env { __dontuse, .. } => __dontuse.1.no(),
            Self::PreVars { __dontuse, .. } => __dontuse.1.no(),
        }
    }

    /// Place holder evaluation of the template; any segment that requires a provider value will be
    /// filled in with "*"
    pub fn evaluate_with_star(&self) -> String {
        match self {
            Self::Literal { value } => value.clone(),
            Self::NeedsProviders { script, __dontuse } => script
                .iter()
                .map(|x| match x {
                    ExprSegment::Str(s) => s,
                    ExprSegment::Eval(_) | ExprSegment::ProvDirect(_) => "*",
                })
                .collect(),
            Self::Env { __dontuse, .. } => __dontuse.1.no(),
            Self::PreVars { __dontuse, .. } => __dontuse.1.no(),
        }
    }

    /// Returns Some() if no provider data is required.
    pub fn as_static(&self) -> Option<&str> {
        match self {
            Self::Literal { value } => Some(value),
            _ => None,
        }
    }

    /// Return a set of the names of providers that are required to successfully evaluate this
    /// template.
    ///
    /// If this method return an empty set, then as_static() should return Some()
    pub fn get_required_providers(&self) -> BTreeSet<Arc<str>> {
        match self {
            Self::Literal { .. } => BTreeSet::new(),
            Self::NeedsProviders { script, .. } => script
                .iter()
                .flat_map(|p| match p {
                    ExprSegment::Eval(x) => x.required_providers().into_iter().collect_vec(),
                    ExprSegment::ProvDirect(p) => vec![Arc::clone(p)],
                    ExprSegment::Str(_) => vec![],
                })
                .collect::<BTreeSet<Arc<str>>>()
                .into_iter()
                .collect(),
            Self::PreVars { __dontuse, .. } => __dontuse.1.no(),
            Self::Env { __dontuse, .. } => __dontuse.1.no(),
        }
    }
}

impl<VD: Bool> Template<String, EnvsOnly, VD, False> {
    pub(crate) fn insert_env_vars(
        self,
        evars: &BTreeMap<String, String>,
    ) -> Result<Template<String, EnvsOnly, VD, True>, EnvsError> {
        match self {
            Self::Literal { value } => Ok(Template::Literal { value }),
            Self::Env {
                template,
                __dontuse,
            } => Ok(Template::Literal {
                value: template
                    .insert_env_vars(evars)?
                    .try_collect()
                    .expect("EnvsOnly shouldn't have other types"),
            }),
            Self::PreVars { __dontuse, .. } => __dontuse.0.no(),
            Self::NeedsProviders { __dontuse, .. } => __dontuse.0.no(),
        }
    }
}

impl<V: FromStr, T: TemplateType<ProvAllowed = False>> Template<V, T, True, True>
where
    <V as FromStr>::Err: StdError + Send + Sync + 'static,
{
    pub fn get(&self) -> &V {
        match self {
            Self::Literal { value } => value,
            Self::PreVars { __dontuse, .. } => __dontuse.1.no(),
            Self::Env { __dontuse, .. } => __dontuse.1.no(),
            Self::NeedsProviders { __dontuse, .. } => __dontuse.2.no(),
        }
    }

    pub fn get_mut(&mut self) -> &mut V {
        match self {
            Self::Literal { value } => value,
            Self::PreVars { __dontuse, .. } => __dontuse.1.no(),
            Self::Env { __dontuse, .. } => __dontuse.1.no(),
            Self::NeedsProviders { __dontuse, .. } => __dontuse.2.no(),
        }
    }
}

impl<V, T, VD, ED> Template<V, T, VD, ED>
where
    V: FromStr,
    T: TemplateType,
    VD: Bool,
    ED: Bool,
    V::Err: StdError + Send + Sync + 'static,
{
    pub fn new_literal(value: V) -> Self {
        Self::Literal { value }
    }
}

impl<V: FromStr, T: TemplateType<VarsAllowed = True, EnvsAllowed = False>> PropagateVars
    for Template<V, T, False, True>
where
    V::Err: StdError + Send + Sync + 'static,
{
    type Data<VD: Bool> = Template<V, T, VD, True>;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, VarsError> {
        log::info!(
            "inseting static vars into Templated {}",
            std::any::type_name::<V>()
        );
        match self {
            Self::Literal { value } => Ok(Template::Literal { value }),
            Self::PreVars {
                template,
                next,
                __dontuse,
            } => {
                let s = template.insert_vars(vars)?.collapse();
                next(s)
            }
            Self::NeedsProviders { __dontuse, .. } => __dontuse.1.no(),
            Self::Env { __dontuse, .. } => __dontuse.1.no(),
        }
    }
}

/// Raw templating data, containing segments on where data needs to be read from.
#[derive(Debug, PartialEq, Eq, Deserialize, Clone)]
#[serde(try_from = "Cow<'_, str>")]
#[serde(bound = "")]
#[derive(serde::Serialize)]
#[serde(into = "String")]
pub struct TemplatedString<T: TemplateType>(Vec<Segment<T>>);

impl<T: TemplateType> Display for TemplatedString<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.iter().try_for_each(|seg| Display::fmt(seg, f))
    }
}

impl<T: TemplateType> From<TemplatedString<T>> for String {
    fn from(value: TemplatedString<T>) -> Self {
        value.to_string()
    }
}

#[cfg(feature = "convert")]
use crate::configv1::select_parser::template_convert;

impl<T: TemplateType> TemplatedString<T> {
    #[cfg(feature = "convert")]
    pub(crate) fn convert_from_v1<I: IntoIterator<Item = template_convert::Segment>>(
        input: I,
        var_names: &BTreeSet<Arc<str>>,
    ) -> Result<Self, crate::convert::TemplateSegmentError> {
        input
            .into_iter()
            .map(|s| match s {
                // All differences in templates involve interpolation sections (${}), so outer
                // remains the same
                template_convert::Segment::Outer(s) => Ok(Segment::<T>::Raw(s)),
                template_convert::Segment::SingleSource(s) => {
                    // Assume segment type based on what is allowed, and if there is a var named
                    // that
                    match (
                        T::EnvsAllowed::try_default(),
                        T::VarsAllowed::try_default(),
                        T::ProvAllowed::try_default(),
                        var_names.contains::<str>(&s),
                    ) {
                        (Some(b), None, None, _) => Ok(Segment::Env(s, b)),
                        (None, Some(b), _, true) => Ok(Segment::Var(s, b)),
                        (None, _, Some(b), _) => Ok(Segment::Prov(s, b)),
                        _ => Err(crate::convert::TemplateSegmentError(s)),
                    }
                }
                template_convert::Segment::SingleExpression(x) => {
                    Ok(Segment::Expr(vec![Segment::Raw(x)], True))
                }
                template_convert::Segment::MultiExpression(template_segments) => {
                    let mut segments: Vec<Segment<T, helpers::True>> = vec![];
                    for x in template_segments {
                        match x {
                            template_convert::Segment::Outer(s) => segments.push(Segment::Raw(s)),
                            template_convert::Segment::SingleSource(s) => {
                                // Assume segment type based on what is allowed, and if there is a var named
                                // that
                                match (
                                    T::EnvsAllowed::try_default(),
                                    T::VarsAllowed::try_default(),
                                    T::ProvAllowed::try_default(),
                                    var_names.contains::<str>(&s),
                                ) {
                                    (Some(b), None, None, _) => segments.push(Segment::Env(s, b)),
                                    (None, Some(b), _, true) => segments.push(Segment::Var(s, b)),
                                    (None, _, Some(b), _) => segments.push(Segment::Prov(s, b)),
                                    _ => segments.push(Segment::Raw(
                                        "PLACEHOLDER__PLEASE_UPDATE_MANUALLY".to_owned(),
                                    )),
                                }
                            }
                            template_convert::Segment::SingleExpression(x) => {
                                segments.push(Segment::Raw(x))
                            }
                            template_convert::Segment::MultiExpression(_) => {
                                panic!("Cannot have a MultiExpression inside a MultiExpression")
                            }
                            template_convert::Segment::Placeholder => segments.push(Segment::Raw(
                                "PLACEHOLDER__PLEASE_UPDATE_MANUALLY".to_owned(),
                            )),
                        }
                    }
                    Ok(Segment::Expr(segments, True))
                }
                template_convert::Segment::Placeholder => Ok(Segment::Expr(
                    vec![Segment::Raw(
                        "PLACEHOLDER__PLEASE_UPDATE_MANUALLY".to_owned(),
                    )],
                    True,
                )),
            })
            .collect::<Result<_, _>>()
            .map(Self)
    }

    fn try_collect(self) -> Option<String> {
        self.0
            .into_iter()
            .map(|p| match p {
                parser::Segment::Raw(s) => Some(s),
                _ => None,
            })
            .collect()
    }

    /// Turn adjacent Raw string segments into a single Raw
    fn collapse(self) -> Self {
        self.into_iter()
            .coalesce(|a, b| match (a, b) {
                (Segment::Raw(x), Segment::Raw(y)) => Ok(Segment::Raw(x + &y)),
                (x, y) => Err((x, y)),
            })
            .collect()
    }

    /// Returns Ok() if the template contains a single Raw segment. Otherwise, return Err(self)
    fn into_literal(mut self) -> Result<String, Self> {
        let one = self.0.pop();
        match (one, self.0.len()) {
            (Some(Segment::Raw(s)), 0) => Ok(s),
            (Some(seg), _) => {
                self.0.push(seg);
                Err(self)
            }
            (None, _) => Ok("".to_owned()),
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = &parser::Segment<T>> {
        self.0.iter()
    }

    fn into_regular(self) -> Option<TemplatedString<Regular>> {
        fn map_segment<T: TemplateType, I: Bool>(s: Segment<T, I>) -> Option<Segment<Regular, I>> {
            Some(match s {
                Segment::Raw(s) => Segment::Raw(s),
                Segment::Expr(x, _) => Segment::Expr(
                    x.into_iter().map(map_segment).collect::<Option<_>>()?,
                    TryDefault::try_default()?,
                ),
                Segment::Prov(p, _) => Segment::Prov(p, TryDefault::try_default()?),
                Segment::Env(e, _) => Segment::Env(e, TryDefault::try_default()?),
                Segment::Var(v, _) => Segment::Var(v, TryDefault::try_default()?),
            })
        }
        self.into_iter()
            .map(map_segment)
            .collect::<Option<TemplatedString<Regular>>>()
    }
}

impl<T: TemplateType<ProvAllowed = True, EnvsAllowed = False>> TemplatedString<T> {
    // only call after Vars insertion
    fn into_script(self) -> Result<Vec<ExprSegment>, CreateExprError>
    where
        T::ProvAllowed: OK,
    {
        self.into_iter()
            .map(|s| {
                Ok(match s {
                    Segment::Raw(x) => ExprSegment::Str(Arc::from(x)),
                    Segment::Prov(p, _) => ExprSegment::ProvDirect(Arc::from(p)),
                    Segment::Expr(x, _) => ExprSegment::Eval(EvalExpr::from_template(x)?),
                    _ => unreachable!("need to insert vars first"),
                })
            })
            .collect()
    }
}

impl<T: TemplateType> IntoIterator for TemplatedString<T> {
    type Item = Segment<T>;
    type IntoIter = <Vec<Segment<T>> as IntoIterator>::IntoIter;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl<T: TemplateType> FromIterator<Segment<T>> for TemplatedString<T> {
    fn from_iter<I: IntoIterator<Item = Segment<T>>>(iter: I) -> Self {
        Self(iter.into_iter().collect_vec())
    }
}

impl<T: TemplateType<VarsAllowed = True, EnvsAllowed = False>> PropagateVars
    for TemplatedString<T>
{
    // TemplatedString does not track typestate.
    type Data<VD: Bool> = Self;

    fn insert_vars(self, vars: &super::Vars<True>) -> Result<Self::Data<True>, super::VarsError> {
        self.0
            .into_iter()
            .map(|p| match p {
                Segment::Var(v, True) => {
                    log::debug!("searching for var value {v:?}");
                    super::get_var_at_path(vars, &v)
                        .ok_or_else(|| super::VarsError::VarNotFound(v))
                        .map(|v| Segment::Raw(v.to_string().trim_matches('"').to_owned()))
                }
                Segment::Env(_, no) => no.no(),
                Segment::Expr(v, True) => {
                    let mut has_prov = false;
                    let v = v
                        .into_iter()
                        .map(|s| match s {
                            Segment::Env(_, no) => no.no(),
                            Segment::Expr(_, no) => no.no(),
                            Segment::Var(v, True) => {
                                log::debug!("searching for var value {v:?}");
                                super::get_var_at_path(vars, &v)
                                    .ok_or_else(|| super::VarsError::VarNotFound(v))
                                    .map(|v| Segment::Raw(v.to_string()))
                            }
                            Segment::Prov(p, b) => {
                                has_prov = true;
                                Ok(Segment::Prov(p, b))
                            }
                            other => Ok(other),
                        })
                        .collect::<Result<_, _>>()?;
                    if has_prov {
                        Ok(Segment::Expr(v, True))
                    } else {
                        log::debug!("expr section {v:?} has no providers; evaluating statically");
                        let code = v
                            .into_iter()
                            .map(|s| match s {
                                Segment::Raw(s) => s,
                                Segment::Env(_, no) => no.no(),
                                Segment::Expr(_, no) => no.no(),
                                Segment::Var(_, True) => unreachable!("just inserted vars"),
                                Segment::Prov(..) => unreachable!("checked for no prov"),
                            })
                            .collect::<String>();
                        Ok(Segment::Raw(
                            super::scripting::eval_direct(&code)?
                                .trim_matches('"')
                                .to_owned(),
                        ))
                    }
                }
                other => Ok(other),
            })
            .collect()
    }
}

impl TemplatedString<EnvsOnly> {
    fn insert_env_vars(self, evars: &BTreeMap<String, String>) -> Result<Self, EnvsError> {
        self.0
            .into_iter()
            .map(|p| match p {
                Segment::Env(e, ..) => evars
                    .get(&e)
                    .cloned()
                    .map(Segment::Raw)
                    .ok_or_else(|| MissingEnvVar(e).into()),
                Segment::Expr(x, True) => x
                    .into_iter()
                    .map(|s| match s {
                        Segment::Expr(_, no) => no.no(),
                        Segment::Var(_, no) => no.no(),
                        Segment::Prov(_, no) => no.no(),
                        Segment::Env(e, True) => evars
                            .get(&e)
                            .cloned()
                            // make the String into a valid code literal
                            .map(|ev| format!("\"{}\"", ev.escape_default()))
                            .ok_or_else(|| MissingEnvVar(e).into()),
                        Segment::Raw(s) => Ok(s),
                    })
                    .collect::<Result<String, _>>()
                    .and_then(|x| super::scripting::eval_direct(&x).map_err(Into::into))
                    .map(|s| match &(s.chars().collect_vec()[..]) {
                        ['"', rest @ .., '"'] => Segment::Raw(rest.iter().collect()),
                        _ => Segment::Raw(s),
                    }),
                other => Ok(other),
            })
            .collect()
    }
}

impl<T: TemplateType> FromStr for TemplatedString<T> {
    type Err = parser::TemplateParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        parser::parse_template_string(s).map(Self)
    }
}

impl<T: TemplateType> TryFrom<&str> for TemplatedString<T> {
    type Error = <Self as FromStr>::Err;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        value.parse()
    }
}

impl<T: TemplateType> TryFrom<Cow<'_, str>> for TemplatedString<T> {
    type Error = <Self as FromStr>::Err;

    fn try_from(value: Cow<'_, str>) -> Result<Self, Self::Error> {
        value.parse()
    }
}

impl<T, U> TryDefault for (T, U)
where
    T: TryDefault,
    U: TryDefault,
{
    fn try_default() -> Option<Self> {
        Some((T::try_default()?, U::try_default()?))
    }
}

impl<T, U, V> TryDefault for (T, U, V)
where
    T: TryDefault,
    U: TryDefault,
    V: TryDefault,
{
    fn try_default() -> Option<Self> {
        Some((T::try_default()?, U::try_default()?, V::try_default()?))
    }
}

mod helpers {
    use serde::Deserialize;
    use std::fmt;

    mod private {
        pub trait Seal {}

        impl Seal for super::True {}
        impl Seal for super::False {}
        impl Seal for super::EnvsOnly {}
        impl Seal for super::VarsOnly {}
        impl Seal for super::Regular {}
        impl<T, U> Seal for (T, U)
        where
            T: Seal,
            U: Seal,
        {
        }
        impl<T, U, V> Seal for (T, U, V)
        where
            T: Seal,
            U: Seal,
            V: Seal,
        {
        }
    }

    /// Unit type that only exists to allow enum variants containing to be made.
    #[derive(Default, Deserialize, Debug, PartialEq, Eq, Clone, Copy, serde::Serialize)]
    pub struct True;

    /// Uninhabited type that makes enum variants containing it to be inaccessible.
    #[derive(Deserialize, Debug, PartialEq, Eq, Clone, Copy, serde::Serialize)]
    pub enum False {}

    impl False {
        /// A "call" to this function indicates that the branch is unreachable, since a value of
        /// type False cannot be created.
        pub fn no(&self) -> ! {
            #[cfg(debug_assertions)]
            {
                log::error!("somthing has gone horribly wrong");
                panic!("managed to call no() on a False");
            }
            // last line is only unreachable in debug builds
            #[allow(unreachable_code)]
            unsafe {
                std::hint::unreachable_unchecked()
            }
        }
    }

    /// Trait for trying to get a Default value. Serde itself has no solution (that I could find)
    /// that directly allows making specific enum variants inaccessible, so this is to make
    /// generating a Default value fallible based on the type. If an invaild variant is used (for
    /// example, an env variant for a template outside of the vars section), then
    /// `False::try_default()` will be called, and an error will be forwarded and Deserialize will
    /// fail.
    pub trait TryDefault: Sized + fmt::Debug + private::Seal {
        fn try_default() -> Option<Self>;
    }

    impl TryDefault for True {
        fn try_default() -> Option<Self> {
            Some(Self)
        }
    }

    impl TryDefault for False {
        fn try_default() -> Option<Self> {
            None
        }
    }

    /// Trait for a type that represents a boolean state for if a value can be constructed.
    pub trait Bool:
        fmt::Debug + TryDefault + Clone + Copy + PartialEq + Eq + private::Seal
    {
        type Inverse: Bool + fmt::Debug;

        const VALUE: bool;
    }

    /// Trait meaning that the Boolean type specifically can be created.
    pub trait OK: Default + Bool + private::Seal {}

    impl OK for True {}

    impl Bool for True {
        type Inverse = False;
        const VALUE: bool = true;
    }

    impl Bool for False {
        type Inverse = True;
        const VALUE: bool = false;
    }

    /// Trait for types of templatings allowed. It's not an enumeration of variants, because
    /// Template needs to be generic over a type of this trait.
    pub trait TemplateType: fmt::Debug + private::Seal + PartialEq + Eq + Clone + Copy {
        type EnvsAllowed: Bool;
        type VarsAllowed: Bool;
        type ProvAllowed: Bool;
    }

    /// Marker struct to indicate that this template can only read from OS environment variables as
    /// a source.
    #[derive(Deserialize, Debug, PartialEq, Eq, Clone, Copy)]
    pub struct EnvsOnly;

    impl TemplateType for EnvsOnly {
        type EnvsAllowed = True;
        type VarsAllowed = False;
        type ProvAllowed = False;
    }

    /// Marker struct to indicate that this template can only read from static Vars as a source.
    #[derive(Deserialize, Debug, PartialEq, Eq, Clone, Copy)]
    pub struct VarsOnly;

    impl TemplateType for VarsOnly {
        type EnvsAllowed = False;
        type VarsAllowed = True;
        type ProvAllowed = False;
    }

    /// Marker struct to indicate that this template can read from vars or providers.
    #[derive(Deserialize, Debug, PartialEq, Eq, Clone, Copy)]
    pub struct Regular;

    impl TemplateType for Regular {
        type EnvsAllowed = False;
        type VarsAllowed = True;
        type ProvAllowed = True;
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        super::{VarValue, Vars},
        *,
    };

    #[test]
    fn env_insert() {
        let raw = "${e:PORT}/${x:parseInt(${e:DATA}) + 1}";
        let template: Template<String, EnvsOnly, True, False> = serde_yaml::from_str(raw).unwrap();
        let evars: BTreeMap<_, _> = [
            ("PORT".to_owned(), "5555".to_owned()),
            ("DATA".to_owned(), "1".to_owned()),
        ]
        .into();
        let template = template.insert_env_vars(&evars).unwrap();
        assert_eq!(template.get(), "5555/2");
    }

    #[test]
    fn vars_insert() {
        let raw = "${v:a}--${x:${v:b}[0] + ${v:b.1} + parseInt(${v:c.d}) + ${v:c}.e}";
        let template: Template<String, VarsOnly, False, True> = serde_yaml::from_str(raw).unwrap();
        let vars = Vars::<True>::from([
            ("a".to_owned().into(), VarValue::Bool(true)),
            (
                "b".to_owned().into(),
                VarValue::List(vec![VarValue::Num(45.0), VarValue::Num(23.0)]),
            ),
            (
                "c".to_owned().into(),
                VarValue::Map(
                    [
                        (
                            "d".to_owned().into(),
                            VarValue::Str(Template::new_literal("77".to_owned())),
                        ),
                        ("e".to_owned().into(), VarValue::Num(12.0)),
                        ("e1".to_owned().into(), VarValue::Num(999.0)),
                    ]
                    .into(),
                ),
            ),
        ]);
        let template = template.insert_vars(&vars).unwrap();
        assert_eq!(template.get(), "true--157");

        let raw = "${v:a}--${x:${v:b.0} + 1}--${x:${v:c}[${p:bar} + 1]}";
        let template: Template<String, Regular, False, True> = serde_yaml::from_str(raw).unwrap();
        let template = template.insert_vars(&vars).unwrap();
        assert_eq!(template.evaluate_with_star(), "true--46--*");
        let prov_data = Cow::<serde_json::Value>::Owned(json!({"bar": "e"}));
        assert_eq!(template.evaluate(prov_data).unwrap(), "true--46--999");
    }
}
