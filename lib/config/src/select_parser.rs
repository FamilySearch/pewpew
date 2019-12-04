use crate::expression_functions::{
    Collect, Encode, Entries, Epoch, If, Join, JsonPath, Match, MinMax, Pad, Random, Range, Repeat,
    Replace,
};
use crate::{
    create_marker, json_value_to_string, EndpointProvidesPreProcessed, EndpointProvidesSendOptions,
    WithMarker,
};

use crate::error::{self, ExpressionError as Error};

use ether::{Either, Either3};
use futures::{stream, Future, IntoFuture, Stream};
use itertools::Itertools;
use pest::{
    iterators::{Pair, Pairs},
    Parser as PestParser,
};
use pest_derive::Parser;
use serde_json as json;
use yaml_rust::scanner::Marker;
use zip_all::zip_all;

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    iter,
    sync::Arc,
};

pub trait ProviderStream<Ar: Clone + Send + Sync + 'static> {
    fn into_stream(
        &self,
    ) -> Box<dyn Stream<Item = (json::Value, Vec<Ar>), Error = Error> + Send + Sync + 'static>;
}

#[derive(Clone, Debug, Default)]
pub struct RequiredProviders {
    inner: BTreeMap<String, Marker>,
    special: u16,
    where_special: u16,
    is_where: bool,
}

impl RequiredProviders {
    pub fn new() -> Self {
        RequiredProviders {
            inner: BTreeMap::new(),
            special: 0,
            where_special: 0,
            is_where: false,
        }
    }

    fn is_where(&mut self) {
        self.is_where = true;
    }

    pub(super) fn insert(&mut self, s: String, marker: Marker) {
        let special = if self.is_where {
            &mut self.where_special
        } else {
            &mut self.special
        };
        match &*s {
            "request.start-line" => *special |= REQUEST_STARTLINE,
            "request.headers" => *special |= REQUEST_HEADERS,
            "request.body" => *special |= REQUEST_BODY,
            "request.method" => *special |= REQUEST_METHOD,
            "request.url" => *special |= REQUEST_URL,
            "request" => *special |= REQUEST_ALL,
            "response.start-line" => *special |= RESPONSE_STARTLINE,
            "response.headers" => *special |= RESPONSE_HEADERS,
            "response.body" => *special |= RESPONSE_BODY,
            "response" => *special |= RESPONSE_ALL,
            "response.status" => *special |= RESPONSE_STATUS,
            "stats" => *special |= STATS,
            "for_each" => *special |= FOR_EACH,
            "error" => *special |= ERROR,
            _ => {
                self.inner.insert(s, marker);
            }
        }
    }

    pub(super) fn remove(&mut self, s: &str) {
        self.inner.remove(s);
    }

    pub(super) fn extend(&mut self, other: RequiredProviders) {
        self.special |= other.special;
        self.where_special |= other.special;
        self.inner.extend(other.inner);
    }

    pub fn into_inner(self) -> BTreeMap<String, Marker> {
        self.inner
    }

    pub fn unique_providers(self) -> BTreeSet<String> {
        self.inner.into_iter().map(|(k, _)| k).collect()
    }

    pub fn contains(&self, p: &str) -> bool {
        self.inner.contains_key(p)
    }

    pub fn get_special(&self) -> u16 {
        self.special
    }

    pub fn get_where_special(&self) -> u16 {
        self.where_special
    }

    fn is_empty(&self) -> bool {
        self.special == 0 && self.inner.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &Marker)> {
        self.inner.iter()
    }
}

#[derive(Clone, Debug)]
pub(super) enum FunctionCall {
    Collect(Collect),
    Encode(Encode),
    Entries(Entries),
    Epoch(Epoch),
    If(Box<If>),
    Join(Join),
    JsonPath(JsonPath),
    Match(Match),
    MinMax(MinMax),
    Pad(Pad),
    Random(Random),
    Range(Box<Range>),
    Repeat(Repeat),
    Replace(Box<Replace>),
}

impl FunctionCall {
    fn new(
        ident: &str,
        args: Vec<ValueOrExpression>,
        providers: &mut RequiredProviders,
        static_vars: &BTreeMap<String, json::Value>,
        marker: Marker,
    ) -> Result<Either<Self, json::Value>, Error> {
        let r = match ident {
            "collect" => Either::A(FunctionCall::Collect(Collect::new(args, marker)?)),
            "encode" => Encode::new(args, marker)?.map_a(FunctionCall::Encode),
            "end_pad" => Pad::new(false, args, marker)?.map_a(FunctionCall::Pad),
            "entries" => Either::A(FunctionCall::Entries(Entries::new(args, marker)?)),
            "epoch" => Either::A(FunctionCall::Epoch(Epoch::new(args, marker)?)),
            "if" => If::new(args, marker)?.map_a(|a| FunctionCall::If(a.into())),
            "join" => Join::new(args, marker)?.map_a(FunctionCall::Join),
            "json_path" => {
                JsonPath::new(args, providers, static_vars, marker)?.map_a(FunctionCall::JsonPath)
            }
            "match" => Match::new(args, marker)?.map_a(FunctionCall::Match),
            "max" => MinMax::new(false, args)?.map_a(FunctionCall::MinMax),
            "min" => MinMax::new(true, args)?.map_a(FunctionCall::MinMax),
            "start_pad" => Pad::new(true, args, marker)?.map_a(FunctionCall::Pad),
            "random" => Either::A(FunctionCall::Random(Random::new(args, marker)?)),
            "range" => Either::A(FunctionCall::Range(Range::new(args, marker)?.into())),
            "repeat" => Either::A(FunctionCall::Repeat(Repeat::new(args, marker)?)),
            "replace" => Replace::new(args, marker)?.map_a(|r| FunctionCall::Replace(r.into())),
            _ => return Err(Error::UnknownFunction(ident.into(), marker)),
        };
        Ok(r)
    }

    fn evaluate<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<Cow<'a, json::Value>, Error> {
        match self {
            FunctionCall::Collect(c) => c.evaluate(d, no_recoverable_error, for_each),
            FunctionCall::Encode(e) => e.evaluate(d, no_recoverable_error, for_each),
            FunctionCall::Entries(e) => e.evaluate(d, no_recoverable_error, for_each),
            FunctionCall::Epoch(e) => e.evaluate(),
            FunctionCall::If(i) => i.evaluate(d, no_recoverable_error, for_each),
            FunctionCall::Join(j) => j.evaluate(d, no_recoverable_error, for_each),
            FunctionCall::JsonPath(j) => Ok(j.evaluate(d)),
            FunctionCall::Match(m) => m.evaluate(d, no_recoverable_error, for_each),
            FunctionCall::MinMax(m) => m.evaluate(d, no_recoverable_error, for_each),
            FunctionCall::Pad(p) => p.evaluate(d, no_recoverable_error, for_each),
            FunctionCall::Range(r) => r.evaluate(d, no_recoverable_error, for_each),
            FunctionCall::Random(r) => Ok(r.evaluate()),
            FunctionCall::Repeat(r) => Ok(r.evaluate()),
            FunctionCall::Replace(r) => r.evaluate(d, no_recoverable_error, for_each),
        }
    }

    fn evaluate_as_iter<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<impl Iterator<Item = Cow<'a, json::Value>> + Clone, Error> {
        let r =
            match self {
                FunctionCall::Collect(c) => Either3::A(Either3::A(c.evaluate_as_iter(
                    d,
                    no_recoverable_error,
                    for_each,
                )?)),
                FunctionCall::Encode(e) => Either3::A(Either3::B(e.evaluate_as_iter(
                    d,
                    no_recoverable_error,
                    for_each,
                )?)),
                FunctionCall::Entries(e) => Either3::A(Either3::C(Either3::A(
                    e.evaluate_as_iter(d, no_recoverable_error, for_each)?,
                ))),
                FunctionCall::Epoch(e) => Either3::A(Either3::C(Either3::B(e.evaluate_as_iter()?))),
                FunctionCall::If(i) => Either3::A(Either3::C(Either3::C(i.evaluate_as_iter(
                    d,
                    no_recoverable_error,
                    for_each,
                )?))),
                FunctionCall::Join(j) => Either3::B(Either3::A(j.evaluate_as_iter(
                    d,
                    no_recoverable_error,
                    for_each,
                )?)),
                FunctionCall::JsonPath(j) => Either3::B(Either3::B(j.evaluate_as_iter(d))),
                FunctionCall::Match(m) => Either3::B(Either3::C(m.evaluate_as_iter(
                    d,
                    no_recoverable_error,
                    for_each,
                )?)),
                FunctionCall::MinMax(m) => Either3::C(Either3::A(Either3::A(m.evaluate_as_iter(
                    d,
                    no_recoverable_error,
                    for_each,
                )?))),
                FunctionCall::Pad(p) => Either3::C(Either3::A(Either3::B(p.evaluate_as_iter(
                    d,
                    no_recoverable_error,
                    for_each,
                )?))),
                FunctionCall::Random(r) => Either3::C(Either3::A(Either3::C(r.evaluate_as_iter()))),
                FunctionCall::Range(r) => Either3::C(Either3::B(r.evaluate_as_iter(
                    d,
                    no_recoverable_error,
                    for_each,
                )?)),
                FunctionCall::Repeat(r) => Either3::C(Either3::C(Either::A(r.evaluate_as_iter()))),
                FunctionCall::Replace(r) => Either3::C(Either3::C(Either::B(r.evaluate_as_iter(
                    d,
                    no_recoverable_error,
                    for_each,
                )?))),
            };
        Ok(r)
    }

    fn into_stream<Ar: Clone + Send + Sync + 'static, P: ProviderStream<Ar> + 'static>(
        self,
        providers: &BTreeMap<String, P>,
        no_recoverable_error: bool,
    ) -> Box<dyn Stream<Item = (json::Value, Vec<Ar>), Error = Error> + Sync + Send> {
        let f = match self {
            FunctionCall::Collect(c) => {
                Either3::A(Either3::A(c.into_stream(providers, no_recoverable_error)))
            }
            FunctionCall::Encode(e) => {
                Either3::A(Either3::B(e.into_stream(providers, no_recoverable_error)))
            }
            FunctionCall::Entries(e) => Either3::A(Either3::C(Either3::A(
                e.into_stream(providers, no_recoverable_error),
            ))),
            FunctionCall::Epoch(e) => Either3::A(Either3::C(Either3::B(e.into_stream()))),
            FunctionCall::If(i) => Either3::A(Either3::C(Either3::C(
                i.into_stream(providers, no_recoverable_error),
            ))),
            FunctionCall::Join(j) => {
                Either3::B(Either3::A(j.into_stream(providers, no_recoverable_error)))
            }
            FunctionCall::JsonPath(j) => Either3::B(Either3::B(j.into_stream(providers))),
            FunctionCall::Match(m) => {
                Either3::B(Either3::C(m.into_stream(providers, no_recoverable_error)))
            }
            FunctionCall::MinMax(m) => Either3::C(Either3::A(Either3::A(
                m.into_stream(providers, no_recoverable_error),
            ))),
            FunctionCall::Pad(p) => Either3::C(Either3::A(Either3::B(
                p.into_stream(providers, no_recoverable_error),
            ))),
            FunctionCall::Random(r) => Either3::C(Either3::A(Either3::C(r.into_stream()))),
            FunctionCall::Range(r) => {
                Either3::C(Either3::B(r.into_stream(providers, no_recoverable_error)))
            }
            FunctionCall::Repeat(r) => Either3::C(Either3::C(Either::A(r.into_stream()))),
            FunctionCall::Replace(r) => Either3::C(Either3::C(Either::B(
                r.into_stream(providers, no_recoverable_error),
            ))),
        };
        // boxed to prevent recursive impl Stream
        Box::new(f)
    }
}

fn index_json<'a>(
    json: Cow<'a, json::Value>,
    index: Either<&PathSegment, &str>,
    no_err: bool,
    for_each: Option<&[Cow<'a, json::Value>]>,
    marker: Marker,
) -> Result<Cow<'a, json::Value>, Error> {
    #[allow(unused_assignments)]
    let mut holder = None;
    let str_or_number = match index {
        Either::A(jps) => match jps.evaluate(Cow::Borrowed(&*json), for_each)? {
            Either::A(s) => {
                holder = Some(s);
                Either::A(holder.as_ref().expect("should have a value").as_str())
            }
            Either::B(n) => Either::B(n),
        },
        Either::B(s) => Either::A(s),
    };
    let o = match (json, str_or_number) {
        (Cow::Borrowed(json::Value::Object(m)), Either::A(s)) => m.get(s).map(Cow::Borrowed),
        (Cow::Borrowed(json::Value::Object(m)), Either::B(n)) => {
            let s = n.to_string();
            m.get(&s).map(Cow::Borrowed)
        }
        (Cow::Owned(json::Value::Object(mut m)), Either::A(s)) => m.remove(s).map(Cow::Owned),
        (Cow::Borrowed(json::Value::Array(a)), Either::B(n)) => a.get(n).map(Cow::Borrowed),
        (Cow::Owned(json::Value::Array(mut a)), Either::B(n)) => {
            a.get_mut(n).map(|v| Cow::Owned(v.take()))
        }
        (j, Either::A(s)) if s == "length" && j.is_array() => {
            let ret = (j.as_array().expect("json should be an array").len() as u64).into();
            Some(Cow::Owned(ret))
        }
        (json, Either::A(s)) if !no_err => {
            return Err(Error::IndexingIntoJson(s.into(), json.into_owned(), marker));
        }
        (json, Either::B(n)) if !no_err => {
            return Err(Error::IndexingIntoJson(
                format!("[{}]", n),
                json.into_owned(),
                marker,
            ));
        }
        _ => None,
    };
    let o = o.unwrap_or_else(|| Cow::Owned(json::Value::Null));
    Ok(o)
}

fn index_json2<'a>(
    mut json: Cow<'a, json::Value>,
    indexes: &[PathSegment],
    no_err: bool,
    for_each: Option<&[Cow<'a, json::Value>]>,
    marker: Marker,
) -> Result<Cow<'a, json::Value>, Error> {
    for index in indexes.iter() {
        let r = index.evaluate(Cow::Borrowed(&*json), for_each.clone())?;
        let o = match (json, r) {
            (Cow::Borrowed(json::Value::Object(m)), Either::A(ref s)) => {
                m.get(s).map(Cow::Borrowed)
            }
            (Cow::Borrowed(json::Value::Object(m)), Either::B(n)) => {
                let s = n.to_string();
                m.get(&s).map(Cow::Borrowed)
            }
            (Cow::Owned(json::Value::Object(ref mut m)), Either::A(ref s)) => {
                m.remove(s).map(Cow::Owned)
            }
            (Cow::Borrowed(json::Value::Array(a)), Either::B(n)) => a.get(n).map(Cow::Borrowed),
            (Cow::Owned(json::Value::Array(mut a)), Either::B(n)) => {
                a.get_mut(n).map(|v| Cow::Owned(v.take()))
            }
            (ref mut j, Either::A(ref s)) if s == "length" && j.is_array() => {
                let ret = (j.as_array().expect("json should be an array").len() as u64).into();
                Some(Cow::Owned(ret))
            }
            (json, Either::A(s)) if !no_err => {
                return Err(Error::IndexingIntoJson(s, json.into_owned(), marker))
            }
            (json, Either::B(n)) if !no_err => {
                return Err(Error::IndexingIntoJson(
                    format!("[{}]", n),
                    json.into_owned(),
                    marker,
                ));
            }
            _ => None,
        };
        json = o.unwrap_or_else(|| Cow::Owned(json::Value::Null))
    }
    Ok(json)
}

#[derive(Clone, Debug)]
pub struct Path {
    pub(super) start: PathStart,
    pub(super) rest: Vec<PathSegment>,
    pub(super) marker: Marker,
}

impl Path {
    fn evaluate<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<Cow<'a, json::Value>, Error> {
        let (v, rest) = match (&self.start, for_each) {
            (PathStart::FunctionCall(f), _) => (
                f.evaluate(d, no_recoverable_error, for_each.clone())?,
                self.rest.as_slice(),
            ),
            (PathStart::Ident(s), Some(v)) if s == "for_each" => {
                if self.rest.is_empty() {
                    let v = v.iter().map(|c| (**c).clone()).collect();
                    return Ok(Cow::Owned(json::Value::Array(v)));
                } else if let PathSegment::Number(n) = self.rest[0] {
                    let c = v
                        .get(n)
                        .cloned()
                        .unwrap_or_else(|| Cow::Owned(json::Value::Null));
                    (c, &self.rest[1..])
                } else {
                    (Cow::Owned(json::Value::Null), &self.rest[1..])
                }
            }
            (PathStart::Ident(s), _) => (
                index_json(d, Either::B(s), no_recoverable_error, for_each, self.marker)?,
                self.rest.as_slice(),
            ),
            (PathStart::Value(v), _) => (Cow::Borrowed(v), self.rest.as_slice()),
        };
        index_json2(v, rest, no_recoverable_error, for_each, self.marker)
    }

    fn evaluate_as_iter<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<impl Iterator<Item = Result<Cow<'a, json::Value>, Error>> + Clone, Error> {
        let r = match &self.start {
            PathStart::FunctionCall(fnc) => {
                let rest = self.rest.clone();
                Either::A(
                    fnc.evaluate_as_iter(d, no_recoverable_error, for_each)?
                        .map(move |j| {
                            index_json2(j, &rest, no_recoverable_error, None, self.marker)
                        }),
                )
            }
            PathStart::Ident(s) => {
                let (j, rest) = if let ("for_each", Some(v)) = (s.as_str(), for_each) {
                    if self.rest.is_empty() {
                        let v = v.iter().map(|c| (**c).clone()).collect();
                        let b = iter::once(Ok(Cow::Owned(json::Value::Array(v))));
                        return Ok(Either::B(b));
                    } else if let PathSegment::Number(n) = self.rest[0] {
                        let c = v
                            .get(n)
                            .cloned()
                            .unwrap_or_else(|| Cow::Owned(json::Value::Null));
                        (c, &self.rest[1..])
                    } else {
                        (Cow::Owned(json::Value::Null), &self.rest[1..])
                    }
                } else {
                    (
                        index_json(d, Either::B(s), no_recoverable_error, for_each, self.marker)?,
                        self.rest.as_slice(),
                    )
                };
                Either::B(iter::once(Ok(index_json2(
                    j,
                    rest,
                    no_recoverable_error,
                    for_each,
                    self.marker,
                )?)))
            }
            PathStart::Value(v) => Either::B(iter::once(Ok(Cow::Borrowed(v)))),
        };
        Ok(r)
    }

    fn into_stream<Ar: Clone + Send + Sync + 'static, P: ProviderStream<Ar> + 'static>(
        self,
        providers: &BTreeMap<String, P>,
        no_recoverable_error: bool,
    ) -> impl Stream<Item = (json::Value, Vec<Ar>), Error = Error> {
        // TODO: don't we need providers when evaluating `rest`?
        let rest = self.rest;
        let marker = self.marker;
        match self.start {
            PathStart::FunctionCall(fnc) => {
                let a = fnc.into_stream(providers, no_recoverable_error).and_then(
                    move |(j, returns)| {
                        let v =
                            index_json2(Cow::Owned(j), &rest, no_recoverable_error, None, marker)?
                                .into_owned();
                        Ok((v, returns))
                    },
                );
                Either3::A(a)
            }
            PathStart::Ident(s) => {
                let s = Arc::new(s);
                let s2 = s.clone();
                let b = providers
                    .get(&*s2)
                    .map(move |provider| {
                        provider.into_stream().and_then(move |(v, outgoing)| {
                            let v = index_json2(
                                Cow::Owned(v),
                                &rest,
                                no_recoverable_error,
                                None,
                                marker,
                            )?
                            .into_owned();
                            Ok((v, outgoing))
                        })
                    })
                    .ok_or_else(move || Error::UnknownProvider((&*s).clone(), marker))
                    .into_future()
                    .flatten_stream();
                Either3::B(b)
            }
            PathStart::Value(v) => {
                let v = index_json2(Cow::Owned(v), &rest, no_recoverable_error, None, marker)
                    .map(|v| (v.into_owned(), Vec::new()));
                Either3::C(stream::iter_result(iter::repeat(v)))
            }
        }
    }
}

pub(super) fn bool_value(json: &json::Value) -> Result<bool, Error> {
    let r = match json {
        json::Value::Null => false,
        json::Value::Bool(b) => *b,
        json::Value::Number(n) if n.is_i64() => n.as_i64().expect("should be i64") != 0,
        json::Value::Number(n) if n.is_u64() => n.as_u64().expect("should be u64") != 0,
        json::Value::Number(n) if n.is_f64() => n.as_f64().expect("should be f64") != 0f64,
        json::Value::Number(_) => unreachable!("Number should always be i64, u64 or f64"),
        json::Value::String(s) => !s.is_empty(),
        json::Value::Object(_) | json::Value::Array(_) => true,
    };
    Ok(r)
}

pub(super) fn f64_value(json: &json::Value) -> f64 {
    if let Some(f) = json.as_f64() {
        f
    } else {
        std::f64::NAN
    }
}

#[derive(Clone, Debug)]
pub enum ValueOrExpression {
    Value(Value),
    Expression(Expression),
}

impl ValueOrExpression {
    pub fn new(
        expr: &str,
        providers: &mut RequiredProviders,
        static_vars: &BTreeMap<String, json::Value>,
        no_recoverable_error: bool,
        marker: Marker,
    ) -> Result<Self, Error> {
        let pairs = Parser::parse(Rule::entry_point, expr)
            .map_err(|e| Error::InvalidExpression(e, marker))?;
        let e = parse_expression(pairs, providers, static_vars, no_recoverable_error, marker)?;
        ValueOrExpression::from_expression(e)
    }

    fn from_expression(e: Expression) -> Result<Self, Error> {
        let voe = match e.simplify_to_json()? {
            Either::A(v) => ValueOrExpression::Value(Value::Json(v)),
            Either::B(e) => ValueOrExpression::Expression(e),
        };
        Ok(voe)
    }

    pub(super) fn evaluate<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<Cow<'a, json::Value>, Error> {
        match self {
            ValueOrExpression::Value(v) => v.evaluate(d, no_recoverable_error, for_each),
            ValueOrExpression::Expression(e) => e.evaluate(d, no_recoverable_error, for_each),
        }
    }

    pub(super) fn evaluate_as_iter<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<impl Iterator<Item = Result<Cow<'a, json::Value>, Error>> + Clone, Error> {
        match self {
            ValueOrExpression::Value(v) => Ok(Either::A(v.evaluate_as_iter(
                d,
                no_recoverable_error,
                for_each,
            )?)),
            ValueOrExpression::Expression(e) => Ok(Either::B(e.evaluate_as_iter(
                d,
                no_recoverable_error,
                for_each,
            )?)),
        }
    }

    pub fn into_stream<Ar: Clone + Send + Sync + 'static, P: ProviderStream<Ar> + 'static>(
        self,
        providers: &BTreeMap<String, P>,
        no_recoverable_error: bool,
    ) -> impl Stream<Item = (json::Value, Vec<Ar>), Error = Error> {
        match self {
            ValueOrExpression::Value(v) => {
                Either::A(v.into_stream(providers, no_recoverable_error))
            }
            ValueOrExpression::Expression(ce) => {
                Either::B(ce.into_stream(providers, no_recoverable_error))
            }
        }
    }
}

#[derive(Clone, Debug)]
pub enum Value {
    Path(Box<Path>),
    Json(json::Value),
    Template(Template),
}

impl Value {
    fn evaluate<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<Cow<'a, json::Value>, Error> {
        let v = match self {
            Value::Path(path) => path.evaluate(d, no_recoverable_error, for_each)?,
            Value::Json(value) => Cow::Borrowed(value),
            Value::Template(t) => Cow::Owned(t.evaluate(d, for_each)?.into()),
        };
        Ok(v)
    }

    fn evaluate_as_iter<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<impl Iterator<Item = Result<Cow<'a, json::Value>, Error>> + Clone, Error> {
        let r = match self {
            Value::Path(path) => Either3::A(
                path.evaluate_as_iter(d, no_recoverable_error, for_each)?
                    .map(|v| match v {
                        Ok(Cow::Borrowed(json::Value::Array(v))) => {
                            Either3::A(v.iter().map(|v| Ok(Cow::Borrowed(v))))
                        }
                        Ok(Cow::Owned(json::Value::Array(v))) => {
                            Either3::B(v.into_iter().map(|v| Ok(Cow::Owned(v))))
                        }
                        _ => Either3::C(iter::once(v)),
                    })
                    .flatten(),
            ),
            _ => {
                let value = self.evaluate(d, no_recoverable_error, for_each)?;
                match value {
                    Cow::Borrowed(json::Value::Array(v)) => {
                        let ba = v.iter().map(|v| Ok(Cow::Borrowed(v)));
                        Either3::B(Either::A(ba))
                    }
                    Cow::Owned(json::Value::Array(v)) => {
                        let bb = v.into_iter().map(|v| Ok(Cow::Owned(v)));
                        Either3::B(Either::B(bb))
                    }
                    _ => Either3::C(iter::once(Ok(value))),
                }
            }
        };
        Ok(r)
    }

    fn into_stream<Ar: Clone + Send + Sync + 'static, P: ProviderStream<Ar> + 'static>(
        self,
        providers: &BTreeMap<String, P>,
        no_recoverable_error: bool,
    ) -> Box<dyn Stream<Item = (json::Value, Vec<Ar>), Error = Error> + Sync + Send> {
        let s = match self {
            Value::Path(path) => Either3::A(path.into_stream(providers, no_recoverable_error)),
            Value::Json(value) => Either3::B(stream::repeat((value, Vec::new()))),
            Value::Template(t) => {
                let c = t
                    .into_stream(providers)
                    .map(|(s, v)| (json::Value::String(s), v));
                Either3::C(c)
            }
        };
        // boxed to prevent recursive impl Stream
        Box::new(s)
    }
}

#[derive(Clone, Debug)]
pub(super) enum PathSegment {
    Number(usize),
    String(String),
    Template(Arc<Template>),
}

impl PathSegment {
    fn from_str(
        s: &str,
        providers: &mut RequiredProviders,
        static_vars: &BTreeMap<String, json::Value>,
        no_recoverable_error: bool,
        marker: Marker,
    ) -> Result<Self, Error> {
        let template = Template::new(s, static_vars, providers, no_recoverable_error, marker)?;
        let r = match template.simplify_to_string() {
            Either::A(s) => PathSegment::String(s),
            Either::B(t) => PathSegment::Template(t.into()),
        };
        Ok(r)
    }

    fn evaluate<'a>(
        &self,
        d: Cow<'a, json::Value>,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<Either<String, usize>, Error> {
        let r = match self {
            PathSegment::Number(n) => Either::B(*n),
            PathSegment::String(s) => Either::A(s.clone()),
            PathSegment::Template(t) => Either::A(t.evaluate(d, for_each)?),
        };
        Ok(r)
    }
}

#[derive(Clone, Debug)]
pub(super) enum PathStart {
    FunctionCall(FunctionCall),
    Ident(String),
    Value(json::Value),
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum InfixOperator {
    Add = 0,
    And = 1,
    Divide = 2,
    Eq = 3,
    Gt = 4,
    Gte = 5,
    Lt = 6,
    Lte = 7,
    Mod = 8,
    Multiply = 9,
    Ne = 10,
    Or = 11,
    Subtract = 12,
}

static INFIX_OPERATOR_PRECEDENCE: [u8; 13] = [
    4, // Add
    2, // And
    5, // Divide
    3, // Eq
    3, // Gt
    3, // Gte
    3, // Lt
    3, // Lte
    5, // Mod
    5, // Multiply
    3, // Ne
    1, // Or
    4, // Subtract
];

fn to_json_number(n: f64) -> json::Value {
    if n - n.trunc() < std::f64::EPSILON {
        (n as u64).into()
    } else {
        n.into()
    }
}

impl InfixOperator {
    fn evaluate<'a>(
        self,
        left: &json::Value,
        right: Result<Cow<'a, json::Value>, Error>,
    ) -> Result<json::Value, Error> {
        let value = match self {
            InfixOperator::Add => {
                let n = f64_value(left) + f64_value(&*right?);
                to_json_number(n)
            }
            InfixOperator::And => {
                let b = bool_value(left)? && bool_value(&*right?)?;
                b.into()
            }
            InfixOperator::Divide => {
                let n = f64_value(left) / f64_value(&*right?);
                to_json_number(n)
            }
            InfixOperator::Eq => left.eq(&*right?).into(),
            InfixOperator::Gt => {
                let b = f64_value(left) > f64_value(&*right?);
                b.into()
            }
            InfixOperator::Gte => {
                let b = f64_value(left) >= f64_value(&*right?);
                b.into()
            }
            InfixOperator::Lt => {
                let b = f64_value(left) < f64_value(&*right?);
                b.into()
            }
            InfixOperator::Lte => {
                let b = f64_value(left) <= f64_value(&*right?);
                b.into()
            }
            InfixOperator::Mod => {
                let n = f64_value(left) % f64_value(&*right?);
                to_json_number(n)
            }
            InfixOperator::Multiply => {
                let n = f64_value(left) * f64_value(&*right?);
                to_json_number(n)
            }
            InfixOperator::Ne => left.ne(&*right?).into(),
            InfixOperator::Or => {
                let b = bool_value(left)? || bool_value(&*right?)?;
                b.into()
            }
            InfixOperator::Subtract => {
                let n = f64_value(left) - f64_value(&*right?);
                to_json_number(n)
            }
        };
        Ok(value)
    }
}

#[derive(Clone, Debug)]
enum ExpressionLhs {
    Expression(Box<Expression>),
    Value(Value),
}

#[derive(Clone, Debug)]
pub struct Expression {
    not: Option<bool>,
    lhs: ExpressionLhs,
    op: Option<(InfixOperator, Box<Expression>)>,
}

impl Expression {
    fn evaluate<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<Cow<'a, json::Value>, Error> {
        let mut v = if let Some((op, rhs)) = &self.op {
            let v = match &self.lhs {
                ExpressionLhs::Expression(e) => {
                    e.evaluate(Cow::Borrowed(&*d), no_recoverable_error, for_each.clone())?
                }
                ExpressionLhs::Value(v) => {
                    v.evaluate(Cow::Borrowed(&*d), no_recoverable_error, for_each.clone())?
                }
            };
            let rhs = rhs.evaluate(Cow::Borrowed(&*d), no_recoverable_error, for_each);
            Cow::Owned(op.evaluate(&*v, rhs)?)
        } else {
            match &self.lhs {
                ExpressionLhs::Expression(e) => e.evaluate(d, no_recoverable_error, for_each)?,
                ExpressionLhs::Value(v) => v.evaluate(d, no_recoverable_error, for_each)?,
            }
        };
        match self.not {
            Some(true) => {
                let b = !bool_value(&v)?;
                v = Cow::Owned(b.into());
            }
            Some(false) => {
                let b = bool_value(&*v)?;
                v = Cow::Owned(b.into());
            }
            _ => (),
        }
        Ok(v)
    }

    fn evaluate_as_iter<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<impl Iterator<Item = Result<Cow<'a, json::Value>, Error>> + Clone, Error> {
        let i = if let (None, None, ExpressionLhs::Value(v)) = (&self.op, &self.not, &self.lhs) {
            Either3::A(v.evaluate_as_iter(d, no_recoverable_error, for_each)?)
        } else {
            let value = self.evaluate(d, no_recoverable_error, for_each)?;
            match value {
                Cow::Borrowed(json::Value::Array(v)) => {
                    Either3::B(Either::A(v.iter().map(|j| Ok(Cow::Borrowed(j)))))
                }
                Cow::Owned(json::Value::Array(v)) => {
                    Either3::B(Either::B(v.into_iter().map(|j| Ok(Cow::Owned(j)))))
                }
                _ => Either3::C(iter::once(Ok(value))),
            }
        };
        Ok(Box::new(i))
    }

    fn into_stream<Ar: Clone + Send + Sync + 'static, P: ProviderStream<Ar> + 'static>(
        self,
        providers: &BTreeMap<String, P>,
        no_recoverable_error: bool,
    ) -> Box<dyn Stream<Item = (json::Value, Vec<Ar>), Error = Error> + Send + Sync> {
        let v = match self.lhs {
            ExpressionLhs::Expression(e) => {
                Either::A(e.into_stream(providers, no_recoverable_error))
            }
            ExpressionLhs::Value(v) => Either::B(v.into_stream(providers, no_recoverable_error)),
        };
        let not = self.not;
        let v = if let Some((op, rhs)) = self.op {
            let a = v
                .zip(rhs.into_stream(providers, no_recoverable_error))
                .and_then(move |((lhs, mut returns), (r, returns2))| {
                    returns.extend(returns2);
                    let rhs = Ok(Cow::Owned(r));
                    let mut v = op.evaluate(&lhs, rhs)?;
                    if let Some(not) = not {
                        let mut b = bool_value(&v)?;
                        if not {
                            b = !b;
                        }
                        v = b.into()
                    }
                    Ok((v, returns))
                });
            Either::A(a)
        } else {
            let b = v.and_then(move |(mut v, returns)| {
                if let Some(not) = not {
                    let mut b = bool_value(&v)?;
                    if not {
                        b = !b;
                    }
                    v = b.into()
                }
                Ok((v, returns))
            });
            Either::B(b)
        };
        Box::new(v)
    }

    fn simplify_to_json(self) -> Result<Either<json::Value, Self>, Error> {
        let aorb = match self {
            Expression {
                lhs: ExpressionLhs::Value(Value::Json(v)),
                op: None,
                ..
            } => {
                if let Some(not) = self.not {
                    let b = bool_value(&v)?;
                    if not {
                        Either::A((!b).into())
                    } else {
                        Either::A(b.into())
                    }
                } else {
                    Either::A(v)
                }
            }
            Expression {
                lhs: ExpressionLhs::Expression(e),
                op: None,
                ..
            } => return e.simplify_to_json(),
            e => Either::B(e),
        };
        Ok(aorb)
    }

    fn simplify_to_string(self) -> Result<Either<String, Self>, Error> {
        Ok(self
            .simplify_to_json()?
            .map_a(|v| json_value_to_string(Cow::Owned(v)).into_owned()))
    }
}

#[derive(Clone)]
enum ParsedSelect {
    Null,
    Bool(bool),
    Number(json::Number),
    Expression(ValueOrExpression),
    Array(Vec<ParsedSelect>),
    Object(Vec<(String, ParsedSelect)>),
}

impl ParsedSelect {
    fn evaluate<'a, 'b: 'a>(
        &'b self,
        d: Cow<'a, json::Value>,
        no_recoverable_error: bool,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<Cow<'a, json::Value>, Error> {
        let r = match self {
            ParsedSelect::Null => Cow::Owned(json::Value::Null),
            ParsedSelect::Bool(b) => Cow::Owned(json::Value::Bool(*b)),
            ParsedSelect::Number(n) => Cow::Owned(json::Value::Number(n.clone())),
            ParsedSelect::Expression(v) => v.evaluate(d, no_recoverable_error, for_each)?,
            ParsedSelect::Array(v) => {
                let v = v
                    .iter()
                    .map(|p| {
                        p.evaluate(Cow::Borrowed(&*d), no_recoverable_error, for_each.clone())
                            .map(Cow::into_owned)
                    })
                    .collect::<Result<_, _>>()?;
                Cow::Owned(json::Value::Array(v))
            }
            ParsedSelect::Object(v) => {
                let m = v
                    .iter()
                    .map(|(k, v)| {
                        let v = v
                            .evaluate(Cow::Borrowed(&*d), no_recoverable_error, for_each.clone())?
                            .into_owned();
                        Ok::<_, Error>((k.clone(), v))
                    })
                    .collect::<Result<_, _>>()?;
                Cow::Owned(json::Value::Object(m))
            }
        };
        Ok(r)
    }
}

pub const REQUEST_STARTLINE: u16 = 0b0_000_000_100;
pub const REQUEST_HEADERS: u16 = 0b0_000_000_010;
pub const REQUEST_BODY: u16 = 0b0_000_000_001;
pub const REQUEST_METHOD: u16 = 0b10_000_000_000;
const REQUEST_ALL: u16 =
    REQUEST_STARTLINE | REQUEST_HEADERS | REQUEST_BODY | REQUEST_URL | REQUEST_METHOD;
pub const RESPONSE_STARTLINE: u16 = 0b0_000_100_000;
pub const RESPONSE_HEADERS: u16 = 0b0_000_010_000;
pub const RESPONSE_BODY: u16 = 0b0_000_001_000;
pub const RESPONSE_STATUS: u16 = 0b100_000_000;
const RESPONSE_ALL: u16 = RESPONSE_STARTLINE | RESPONSE_HEADERS | RESPONSE_BODY | RESPONSE_STATUS;
const FOR_EACH: u16 = 0b0_001_000_000;
pub const STATS: u16 = 0b0_010_000_000;
pub const REQUEST_URL: u16 = 0b0_100_000_000;
pub const ERROR: u16 = 0b1_000_000_000;

#[grammar = "select.pest"]
#[derive(Parser)]
struct Parser;

#[derive(Clone, Debug)]
enum TemplatePiece {
    Expression(ValueOrExpression),
    NotExpression(String),
}

#[derive(Clone, Debug)]
pub struct Template {
    pieces: Vec<TemplatePiece>,
    size_hint: usize,
    no_recoverable_error: bool,
}

impl Template {
    pub(crate) fn new(
        t: &str,
        static_vars: &BTreeMap<String, json::Value>,
        providers: &mut RequiredProviders,
        no_recoverable_error: bool,
        marker: Marker,
    ) -> Result<Self, Error> {
        let pairs = Parser::parse(Rule::template_entry_point, t)
            .map_err(|e| Error::InvalidExpression(e, marker))?
            .nth(0)
            .expect("Expected 1 pair from parser")
            .into_inner();
        let mut pieces = Vec::new();
        // let mut providers = RequiredProviders::new();
        let mut size_hint = 0;
        for pair in pairs {
            let piece = match pair.as_rule() {
                Rule::template_expression => {
                    let e = parse_expression(
                        pair.into_inner(),
                        providers,
                        static_vars,
                        no_recoverable_error,
                        marker,
                    )?;
                    match e.simplify_to_string()? {
                        Either::A(s2) => {
                            if let Some(TemplatePiece::NotExpression(s)) = pieces.last_mut() {
                                s.push_str(&s2);
                                continue;
                            } else {
                                TemplatePiece::NotExpression(s2)
                            }
                        }
                        Either::B(e) => {
                            TemplatePiece::Expression(ValueOrExpression::from_expression(e)?)
                        }
                    }
                }
                Rule::template_not_expression => {
                    let s = pair.as_str();
                    size_hint += s.len();
                    TemplatePiece::NotExpression(pair.as_str().into())
                }
                rule => {
                    unreachable!("unexpected rule while parsing template, {:?}", rule);
                }
            };
            pieces.push(piece);
        }
        Ok(Template {
            pieces,
            size_hint,
            no_recoverable_error,
        })
    }

    // #[cfg(test)]
    pub fn simple(t: &str) -> Template {
        let s = yaml_rust::scanner::Scanner::new("".chars());
        let marker = s.mark();
        Template::new(
            t,
            &Default::default(),
            &mut RequiredProviders::new(),
            false,
            marker,
        )
        .unwrap()
    }

    pub fn simplify_to_string(mut self) -> Either<String, Self> {
        if self.is_simple() {
            if let Some(TemplatePiece::NotExpression(s)) = self.pieces.pop() {
                Either::A(s)
            } else {
                unreachable!("should not have seen anything other than a not expression")
            }
        } else {
            Either::B(self)
        }
    }

    pub fn is_simple(&self) -> bool {
        if let [TemplatePiece::NotExpression(_)] = self.pieces.as_slice() {
            true
        } else {
            false
        }
    }

    pub fn evaluate<'a>(
        &self,
        d: Cow<'a, json::Value>,
        for_each: Option<&[Cow<'a, json::Value>]>,
    ) -> Result<String, Error> {
        self.pieces
            .iter()
            .map(|piece| match piece {
                TemplatePiece::Expression(voe) => {
                    let v = voe.evaluate(
                        Cow::Borrowed(&*d),
                        self.no_recoverable_error,
                        for_each.clone(),
                    )?;
                    Ok(json_value_to_string(v).into_owned())
                }
                TemplatePiece::NotExpression(s) => Ok(s.clone()),
            })
            .collect()
    }

    pub fn evaluate_with_star(&self) -> String {
        self.pieces
            .iter()
            .map(|piece| match piece {
                TemplatePiece::Expression(_) => '*'.to_string(),
                TemplatePiece::NotExpression(s) => s.clone(),
            })
            .join("")
    }

    fn into_stream<Ar: Clone + Send + Sync + 'static, P: ProviderStream<Ar> + 'static>(
        self,
        providers: &BTreeMap<String, P>,
    ) -> impl Stream<Item = (String, Vec<Ar>), Error = Error> {
        let no_recoverable_error = self.no_recoverable_error;
        let streams = self.pieces.into_iter().map(|piece| match piece {
            TemplatePiece::Expression(voe) => {
                let a = voe
                    .into_stream(providers, no_recoverable_error)
                    .map(|v| (json_value_to_string(Cow::Owned(v.0)).into_owned(), v.1));
                Either::A(a)
            }
            TemplatePiece::NotExpression(s) => {
                let b = stream::repeat((s, Vec::new()));
                Either::B(b)
            }
        });
        let size_hint = self.size_hint;
        zip_all(streams).map(move |values| {
            values.into_iter().fold(
                (String::with_capacity(size_hint), Vec::new()),
                |(mut s, mut returns), (s2, returns2)| {
                    s.push_str(&s2);
                    returns.extend(returns2);
                    (s, returns)
                },
            )
        })
    }
}

#[derive(Clone)]
pub struct Select {
    join: Vec<ValueOrExpression>,
    references_for_each: bool,
    where_references_for_each: bool,
    send_behavior: EndpointProvidesSendOptions,
    select: ParsedSelect,
    where_clause: Option<Expression>,
    no_recoverable_error: bool,
}

impl Select {
    // #[cfg(test)]
    pub fn simple<S: Into<json::Value>>(
        select: S,
        send: EndpointProvidesSendOptions,
        for_each: Option<Vec<&'static str>>,
        where_clause: Option<&'static str>,
        required_providers: Option<&mut RequiredProviders>,
    ) -> Self {
        let marker = create_marker();
        let select = WithMarker::new(select.into(), marker);
        let for_each = for_each
            .unwrap_or_default()
            .into_iter()
            .map(|s| WithMarker::new(s.to_string(), marker))
            .collect();
        let where_clause = where_clause.map(|w| WithMarker::new(w.into(), marker));
        let send = Some(send);
        let eppp = EndpointProvidesPreProcessed {
            select,
            send,
            for_each,
            where_clause,
        };
        let mut rp_default = RequiredProviders::new();
        let required_providers = required_providers.unwrap_or_else(|| &mut rp_default);
        Select::new(eppp, &Default::default(), required_providers, false).unwrap()
    }

    pub(crate) fn new(
        provides: EndpointProvidesPreProcessed,
        static_vars: &BTreeMap<String, json::Value>,
        providers: &mut RequiredProviders,
        no_recoverable_error: bool,
    ) -> Result<Self, error::Error> {
        // let mut providers = RequiredProviders::new();
        let join: Vec<_> = provides
            .for_each
            .iter()
            .map(|v| {
                let pairs = Parser::parse(Rule::entry_point, v.inner()).map_err(|e| {
                    error::Error::ExpressionErr(Error::InvalidExpression(e, v.marker()))
                })?;
                let mut providers2 = RequiredProviders::new();
                let e = parse_expression(
                    pairs,
                    &mut providers2,
                    static_vars,
                    no_recoverable_error,
                    v.marker(),
                )?;
                if providers2.get_special() & FOR_EACH != 0 {
                    Err(error::Error::RecursiveForEachReference(v.marker()))
                } else {
                    providers.extend(providers2);
                    ValueOrExpression::from_expression(e).map_err(Into::into)
                }
            })
            .collect::<Result<_, _>>()?;
        let mut where_references_for_each = false;
        let where_clause = provides
            .where_clause
            .as_ref()
            .map(|v| {
                let mut providers2 = RequiredProviders::new();
                providers2.is_where();
                let pairs = Parser::parse(Rule::entry_point, v.inner()).map_err(|e| {
                    error::Error::ExpressionErr(Error::InvalidExpression(e, v.marker()))
                })?;
                let e = parse_expression(
                    pairs,
                    &mut providers2,
                    static_vars,
                    no_recoverable_error,
                    v.marker(),
                )?;
                where_references_for_each = providers2.get_special() & FOR_EACH != 0;
                if where_references_for_each && join.is_empty() {
                    return Err(error::Error::MissingForEach(v.marker()));
                }
                providers.extend(providers2);
                Ok::<_, error::Error>(e)
            })
            .transpose()?;
        let mut providers2 = RequiredProviders::new();
        let (select, marker) = provides.select.destruct();
        let select = parse_select(
            select,
            &mut providers2,
            static_vars,
            no_recoverable_error,
            marker,
        )?;
        let references_for_each = providers2.get_special() & FOR_EACH != 0;
        if references_for_each && join.is_empty() {
            return Err(error::Error::MissingForEach(marker));
        }
        providers.extend(providers2);

        Ok(Select {
            join,
            no_recoverable_error,
            references_for_each,
            select,
            send_behavior: provides.send.unwrap_or_default(),
            where_clause,
            where_references_for_each,
        })
    }

    pub fn get_send_behavior(&self) -> EndpointProvidesSendOptions {
        self.send_behavior
    }

    pub fn set_send_behavior(&mut self, send_behavior: EndpointProvidesSendOptions) {
        self.send_behavior = send_behavior;
    }

    pub fn execute_where(&self, d: &json::Value) -> Result<bool, Error> {
        self.where_clause
            .as_ref()
            .map(|wc| {
                bool_value(&*wc.evaluate(Cow::Borrowed(d), self.no_recoverable_error, None)?)
            })
            .transpose()
            .map(|b| b.unwrap_or(true))
    }

    fn as_iter<'a>(
        &'a self,
        d: &'a json::Value,
    ) -> Result<impl Iterator<Item = Result<Cow<'a, json::Value>, Error>>, Error> {
        let r = if self.join.is_empty() {
            let r = || -> Result<_, Error> {
                if let Some(wc) = &self.where_clause {
                    if !bool_value(&*wc.evaluate(
                        Cow::Borrowed(d),
                        self.no_recoverable_error,
                        None,
                    )?)? {
                        return Ok(Either3::B(iter::empty()));
                    }
                }
                Ok(Either3::A(iter::once(self.select.evaluate(
                    Cow::Borrowed(&*d),
                    self.no_recoverable_error,
                    None,
                ))))
            };
            r()?
        } else {
            let references_for_each = self.references_for_each;
            let no_recoverable_error = self.no_recoverable_error;
            if self.where_references_for_each {
                let a = self
                    .join
                    .iter()
                    .map(|v| {
                        match v.evaluate_as_iter(
                            Cow::Borrowed(&*d),
                            self.no_recoverable_error,
                            None,
                        ) {
                            Ok(i) => Either::A(i),
                            Err(e) => Either::B(iter::once(Err(e))),
                        }
                    })
                    .multi_cartesian_product()
                    .map(move |v| {
                        let for_each = if references_for_each {
                            let v: Vec<_> = v.into_iter().collect::<Result<_, _>>()?;
                            Some(v)
                        } else {
                            None
                        };
                        if let Some(wc) = &self.where_clause {
                            if !bool_value(&*wc.evaluate(
                                Cow::Borrowed(&*d),
                                no_recoverable_error,
                                for_each.as_ref().map(Vec::as_slice),
                            )?)? {
                                return Ok(None);
                            }
                        }
                        self.select
                            .evaluate(
                                Cow::Borrowed(&*d),
                                no_recoverable_error,
                                for_each.as_ref().map(Vec::as_slice),
                            )
                            .map(Some)
                    })
                    .filter_map(Result::transpose);
                Either3::C(Either3::A(a))
            } else {
                match &self.where_clause {
                    Some(wc)
                        if !bool_value(&*wc.evaluate(
                            Cow::Borrowed(&*d),
                            no_recoverable_error,
                            None,
                        )?)? =>
                    {
                        Either3::C(Either3::B(iter::empty()))
                    }
                    _ => {
                        let c = self
                            .join
                            .iter()
                            .map(|v| {
                                match v.evaluate_as_iter(
                                    Cow::Borrowed(&*d),
                                    self.no_recoverable_error,
                                    None,
                                ) {
                                    Ok(i) => Either::A(i),
                                    Err(e) => Either::B(iter::once(Err(e))),
                                }
                            })
                            .multi_cartesian_product()
                            .map(move |v| {
                                let for_each = if references_for_each {
                                    let v: Vec<_> = v.into_iter().collect::<Result<_, _>>()?;
                                    Some(v)
                                } else {
                                    None
                                };
                                self.select
                                    .evaluate(
                                        Cow::Borrowed(&*d),
                                        no_recoverable_error,
                                        for_each.as_ref().map(Vec::as_slice),
                                    )
                                    .map(Some)
                            })
                            .filter_map(Result::transpose);
                        Either3::C(Either3::C(c))
                    }
                }
            }
        };
        Ok(r.fuse())
    }

    pub fn iter(
        self: Arc<Self>,
        d: Arc<json::Value>,
    ) -> Result<impl Iterator<Item = Result<json::Value, Error>>, Error> {
        let mut iter = None;
        Ok(iter::from_fn(move || {
            let iter2 = match &mut iter {
                Some(i) => i,
                None => {
                    // TODO: get rid of unsafe by creating a custom iterator which will do the
                    // `map` -> `multi_cartesian_product` -> `map` of the above `as_iter` in one closure/method
                    // this should be safe because the Arc will outlive the references (and iterator) created below
                    let (select, data) = unsafe {
                        let select: &'_ Self = &*(&*self as *const _);
                        let data: &'_ json::Value = &*(&*d as *const _);
                        (select, data)
                    };
                    iter = match select.as_iter(data) {
                        Ok(i) => Some(i),
                        Err(e) => return Some(Err(e)),
                    };
                    iter.as_mut().expect("just set iter")
                }
            };
            iter2.next().map(|r| r.map(Cow::into_owned))
        }))
    }
}

fn parse_select(
    select: json::Value,
    providers: &mut RequiredProviders,
    static_vars: &BTreeMap<String, json::Value>,
    no_recoverable_error: bool,
    marker: Marker,
) -> Result<ParsedSelect, Error> {
    let r = match select {
        json::Value::Null => ParsedSelect::Null,
        json::Value::Bool(b) => ParsedSelect::Bool(b),
        json::Value::Number(n) => ParsedSelect::Number(n),
        json::Value::String(s) => {
            let expression =
                ValueOrExpression::new(&s, providers, static_vars, no_recoverable_error, marker)?;
            ParsedSelect::Expression(expression)
        }
        json::Value::Array(a) => {
            let new = a
                .into_iter()
                .map(|v| parse_select(v, providers, static_vars, no_recoverable_error, marker))
                .collect::<Result<_, _>>()?;
            ParsedSelect::Array(new)
        }
        json::Value::Object(m) => {
            let new = m
                .into_iter()
                .map(|(k, v)| {
                    Ok::<_, Error>((
                        k,
                        parse_select(v, providers, static_vars, no_recoverable_error, marker)?,
                    ))
                })
                .collect::<Result<_, _>>()?;
            ParsedSelect::Object(new)
        }
    };
    Ok(r)
}

fn parse_function_call(
    pair: Pair<'_, Rule>,
    providers: &mut RequiredProviders,
    static_vars: &BTreeMap<String, json::Value>,
    no_recoverable_error: bool,
    marker: Marker,
) -> Result<Either<FunctionCall, json::Value>, Error> {
    let mut ident = None;
    let mut args = Vec::new();
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::function_ident => {
                ident = Some(pair.as_str());
            }
            Rule::function_arg => {
                args.push(
                    parse_expression(
                        pair.into_inner(),
                        providers,
                        static_vars,
                        no_recoverable_error,
                        marker,
                    )
                    .and_then(ValueOrExpression::from_expression)?,
                );
            }
            r => {
                unreachable!("Unexpected rule for function call, `{:?}`", r);
            }
        }
    }
    FunctionCall::new(
        ident.expect("expected to have a function identifier"),
        args,
        providers,
        static_vars,
        marker,
    )
}

fn parse_indexed_property(
    pair: Pair<'_, Rule>,
    providers: &mut RequiredProviders,
    static_vars: &BTreeMap<String, json::Value>,
    no_recoverable_error: bool,
    marker: Marker,
) -> Result<PathSegment, Error> {
    let pair = pair
        .into_inner()
        .next()
        .expect("Expected 1 rule while parsing indexed property");
    match pair.as_rule() {
        Rule::string => PathSegment::from_str(
            pair.as_str(),
            providers,
            static_vars,
            no_recoverable_error,
            marker,
        ),
        Rule::integer => Ok(PathSegment::Number(pair.as_str().parse().expect(
            "Expected rule to parse as a number while parsing indexed property",
        ))),
        r => unreachable!("Unexpected rule for path segment, `{:?}`", r),
    }
}

fn parse_path(
    pair: Pair<'_, Rule>,
    providers: &mut RequiredProviders,
    static_vars: &BTreeMap<String, json::Value>,
    no_recoverable_error: bool,
    marker: Marker,
) -> Result<Either<json::Value, Path>, Error> {
    let mut start = None;
    let mut rest = Vec::new();
    let mut providers2 = RequiredProviders::new();
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::function_call => {
                if start.is_none() {
                    let jps = match parse_function_call(
                        pair,
                        &mut providers2,
                        static_vars,
                        no_recoverable_error,
                        marker,
                    )? {
                        Either::A(fc) => PathStart::FunctionCall(fc),
                        Either::B(v) => PathStart::Value(v),
                    };
                    start = Some(jps);
                } else {
                    unreachable!("Encountered unexpected function call while parsing path");
                }
            }
            Rule::json_ident => {
                let s = pair.as_str();
                if start.is_none() {
                    start = static_vars
                        .get(s)
                        .map(|v| PathStart::Value(v.clone()))
                        .or_else(|| Some(PathStart::Ident(s.into())));
                } else {
                    let ps = PathSegment::from_str(
                        pair.as_str(),
                        &mut providers2,
                        static_vars,
                        no_recoverable_error,
                        marker,
                    )?;
                    rest.push(ps);
                }
            }
            Rule::indexed_property => {
                if start.is_none() {
                    unreachable!("Encountered unexpected indexed property while parsing path");
                } else {
                    rest.push(parse_indexed_property(
                        pair,
                        &mut providers2,
                        static_vars,
                        no_recoverable_error,
                        marker,
                    )?);
                }
            }
            r => {
                unreachable!("Unexpected rule while parsing path, `{:?}`", r);
            }
        }
    }
    let start = start.expect("expected there to be a start piece while parsing path");
    if let PathStart::Ident(s) = &start {
        match rest.first() {
            Some(PathSegment::String(next)) if &*s == "request" || &*s == "response" => {
                providers2.insert(format!("{}.{}", s, next), marker);
            }
            _ => {
                providers2.insert(s.clone(), marker);
            }
        };
    }
    let p = Path {
        start,
        rest,
        marker,
    };
    let r = match p.start {
        PathStart::Value(_) if providers2.is_empty() => {
            let a = p
                .evaluate(Cow::Owned(json::Value::Null), no_recoverable_error, None)?
                .into_owned();
            Either::A(a)
        }
        _ => {
            providers.extend(providers2);
            Either::B(p)
        }
    };
    Ok(r)
}

fn parse_value(
    mut pairs: Pairs<'_, Rule>,
    providers: &mut RequiredProviders,
    static_vars: &BTreeMap<String, json::Value>,
    no_recoverable_error: bool,
    marker: Marker,
) -> Result<Value, Error> {
    let pair = pairs
        .next()
        .expect("Expected 1 rule while parsing indexed property");
    let v = match pair.as_rule() {
        Rule::boolean => {
            let b = match pair.as_str() {
                "true" => true,
                "false" => false,
                s => {
                    unreachable!("Expected value to parse as a boolean. Saw `{}`", s);
                }
            };
            Value::Json(b.into())
        }
        Rule::null => Value::Json(json::Value::Null),
        Rule::json_path => {
            match parse_path(pair, providers, static_vars, no_recoverable_error, marker)? {
                Either::A(v) => Value::Json(v),
                Either::B(p) => Value::Path(p.into()),
            }
        }
        Rule::string => {
            let template = Template::new(
                pair.as_str(),
                static_vars,
                providers,
                no_recoverable_error,
                marker,
            )?;
            match template.simplify_to_string() {
                Either::A(s) => Value::Json(s.into()),
                Either::B(t) => Value::Template(t),
            }
        }
        Rule::integer | Rule::decimal => {
            let n = std::str::FromStr::from_str(pair.as_str())
                .expect("Expected value to parse as a number or decimal");
            let j = json::Value::Number(n);
            Value::Json(j)
        }
        r => {
            unreachable!("Unexpected rule while parsing value: {:?}", r);
        }
    };
    Ok(v)
}

#[derive(Debug)]
enum ExpressionOrOperator {
    Expression(Expression),
    Operator(InfixOperator),
}

fn expression_helper(mut items: Vec<ExpressionOrOperator>, level: u8) -> Result<Expression, Error> {
    let i = items.iter().rposition(|eoo| {
        if let ExpressionOrOperator::Operator(o) = eoo {
            INFIX_OPERATOR_PRECEDENCE[*o as usize] == level
        } else {
            false
        }
    });
    match i {
        Some(i) => {
            let mut left = items;
            let right = left.split_off(i + 1);
            let operator = if let Some(ExpressionOrOperator::Operator(o)) = left.pop() {
                o
            } else {
                unreachable!("element at split should have been an operator")
            };
            let mut e = if left.len() == 1 {
                if let Some(ExpressionOrOperator::Expression(e)) = left.pop() {
                    e
                } else {
                    unreachable!("expected an expression but found an operator");
                }
            } else {
                expression_helper(left, level)?
            };
            let right = expression_helper(right, level)?;
            let op = Some((operator, right.into()));
            e = if e.op.is_none() {
                e.op = op;
                e
            } else {
                Expression {
                    lhs: ExpressionLhs::Expression(e.into()),
                    not: None,
                    op,
                }
            };
            Ok(e)
        }
        None if level >= 5 || items.len() == 1 => {
            if items.len() == 1 {
                if let Some(ExpressionOrOperator::Expression(e)) = items.pop() {
                    Ok(e)
                } else {
                    unreachable!(
                        "reached level 5 of operator precedence and found another operator"
                    )
                }
            } else {
                unreachable!(
                    "reached level 5 of operator precedence and still had more than 1 element"
                )
            }
        }
        None => expression_helper(items, level + 1),
    }
}

fn parse_expression_pieces(
    pairs: Pairs<'_, Rule>,
    providers: &mut RequiredProviders,
    static_vars: &BTreeMap<String, json::Value>,
    pieces: &mut Vec<ExpressionOrOperator>,
    no_recoverable_error: bool,
    marker: Marker,
) -> Result<(), Error> {
    let mut not_count = 0;
    let start_len = pieces.len();
    for pair in pairs {
        let rule = pair.as_rule();
        match rule {
            Rule::unary_operator => not_count += 1,
            Rule::value => {
                let v = parse_value(
                    pair.into_inner(),
                    providers,
                    static_vars,
                    no_recoverable_error,
                    marker,
                )?;
                let not = match not_count {
                    0 => None,
                    n => Some(n % 2 == 1),
                };
                not_count = 0;
                let e = Expression {
                    not,
                    lhs: ExpressionLhs::Value(v),
                    op: None,
                };
                let eoo = ExpressionOrOperator::Expression(e);
                pieces.push(eoo);
            }
            Rule::expression => {
                if pieces.len() == start_len {
                    // if nothing has been added to pieces and we're at an expression, it's a "grouped" expression
                    let mut pieces2 = Vec::new();
                    parse_expression_pieces(
                        pair.into_inner(),
                        providers,
                        static_vars,
                        &mut pieces2,
                        no_recoverable_error,
                        marker,
                    )?;
                    let mut e = expression_helper(pieces2, 0)?;
                    let not = match not_count {
                        0 => None,
                        n => Some(n % 2 == 1),
                    };
                    e.not = match (e.not, not) {
                        (Some(true), _) | (_, Some(true)) => Some(true),
                        (Some(false), _) | (_, Some(false)) => Some(false),
                        _ => None,
                    };
                    let eoo = ExpressionOrOperator::Expression(e);
                    pieces.push(eoo);
                } else {
                    parse_expression_pieces(
                        pair.into_inner(),
                        providers,
                        static_vars,
                        pieces,
                        no_recoverable_error,
                        marker,
                    )?;
                }
            }
            Rule::infix_operator => {
                let o = match pair.as_str() {
                    "||" => InfixOperator::Or,
                    "&&" => InfixOperator::And,
                    "==" => InfixOperator::Eq,
                    "!=" => InfixOperator::Ne,
                    ">=" => InfixOperator::Gte,
                    ">" => InfixOperator::Gt,
                    "<=" => InfixOperator::Lte,
                    "<" => InfixOperator::Lt,
                    "+" => InfixOperator::Add,
                    "-" => InfixOperator::Subtract,
                    "*" => InfixOperator::Multiply,
                    "/" => InfixOperator::Divide,
                    "%" => InfixOperator::Mod,
                    o => {
                        unreachable!(
                            "Unexpected operator while parsing simple expression: {:?}",
                            o
                        );
                    }
                };
                let eoo = ExpressionOrOperator::Operator(o);
                pieces.push(eoo);
            }
            Rule::EOI => (),
            r => {
                unreachable!("Unexpected rule while parsing expression: {:?}", r);
            }
        }
    }
    Ok(())
}

fn parse_expression(
    pairs: Pairs<'_, Rule>,
    providers: &mut RequiredProviders,
    static_vars: &BTreeMap<String, json::Value>,
    no_recoverable_error: bool,
    marker: Marker,
) -> Result<Expression, Error> {
    let mut pieces = Vec::new();
    parse_expression_pieces(
        pairs,
        providers,
        static_vars,
        &mut pieces,
        no_recoverable_error,
        marker,
    )?;
    expression_helper(pieces, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::future::{join_all, lazy};
    use maplit::btreemap;
    use serde_json as json;
    // use test_common::literals;
    use tokio::runtime::current_thread;
    use EndpointProvidesSendOptions::*;

    pub struct Literals(Vec<json::Value>);

    impl ProviderStream<()> for Literals {
        fn into_stream(
            &self,
        ) -> Box<dyn Stream<Item = (json::Value, Vec<()>), Error = Error> + Send + Sync + 'static>
        {
            let values = self.0.clone();
            let s = stream::iter_ok(values.into_iter().cycle()).map(|v| (v, Vec::new()));
            Box::new(s)
        }
    }

    pub fn literals(values: Vec<json::Value>) -> Literals {
        Literals(values)
    }

    fn check_results(select: Select, data: json::Value, expect: &[json::Value], i: usize) {
        let result: Vec<_> = select
            .as_iter(&data)
            .unwrap()
            .map(|r| r.map(Cow::into_owned))
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(result.as_slice(), expect, "index {}", i)
    }

    #[test]
    fn get_providers() {
        // (select json, where clause, expected providers returned from `get_providers`, expected providers in `get_special_providers`)
        let check_table = vec![
            (json::json!(4), None, vec![], 0),
            (json::json!("c[0].d"), None, vec!["c"], 0),
            (json::json!("request.body[0].d"), None, vec![], REQUEST_BODY),
            (
                json::json!(r#"request["start-line"]"#),
                None,
                vec![],
                REQUEST_STARTLINE,
            ),
            (json::json!("repeat(5)"), None, vec![], 0),
            (json::json!(r#"json_path("c.*.d")"#), None, vec!["c"], 0),
            (
                json::json!(r#"json_path("c.*.d")"#),
                Some("true && false && true || response.body.id == 123"),
                vec!["c"],
                RESPONSE_BODY,
            ),
            (json::json!(r#"json_path("c.foo.*.d")"#), None, vec!["c"], 0),
            (json::json!(r#"json_path("c.foo.*.d")"#), None, vec!["c"], 0),
            (
                json::json!(r#"json_path("response.headers.*.d")"#),
                None,
                vec![],
                RESPONSE_HEADERS,
            ),
            (json::json!(r#"stats.rtt"#), None, vec![], STATS),
            (json::json!("join(b.e, '-')"), None, vec!["b"], 0),
            (
                json::json!({"z": 42, "dees": r#"json_path("c.*.d")"#, "x": "foo"}),
                None,
                vec!["c", "foo"],
                0,
            ),
        ];

        for (i, (select, where_clause, providers_expect, rr_expect)) in
            check_table.into_iter().enumerate()
        {
            let mut required_providers = RequiredProviders::new();
            Select::simple(
                select,
                Block,
                None,
                where_clause,
                Some(&mut required_providers),
            );
            let rr_providers = required_providers.get_special();
            let providers: Vec<_> = required_providers
                .into_inner()
                .into_iter()
                .map(|(k, _)| k)
                .collect();
            assert_eq!(providers, providers_expect, "index {}", i);
            assert_eq!(rr_providers, rr_expect, "index {}", i);
        }
    }

    #[test]
    fn select() {
        let data = json::json!({
            "a": 3,
            "b": { "foo": "bar", "some:thing": "else", "e": [5, 6, 7, 8] },
            "c": [
                { "d": 1 },
                { "d": 2 },
                { "d": 3 },
            ]
        });

        // (select json, expected out data)
        let check_table = vec![
            (json::json!([1, 2, 3]), vec![json::json!([1, 2, 3])]),
            (
                json::json!([1, "repeat(2)", 3]),
                vec![json::json!([1, [null, null], 3])],
            ),
            (json::json!(4), vec![json::json!(4)]),
            (json::json!("true && false"), vec![false.into()]),
            (json::json!("((true || false))"), vec![true.into()]),
            (json::json!("c[0].d"), vec![json::json!(1)]),
            (json::json!("(c[0].d)"), vec![json::json!(1)]),
            (
                json::json!(r#"`hi${ join(b.e, "-") }`"#),
                vec![json::json!("hi5-6-7-8")],
            ),
            (
                json::json!(r#"`hi${ join( json_path("c.*.d"), "-") }`"#),
                vec![json::json!("hi1-2-3")],
            ),
            (json::json!("c.length"), vec![json::json!(3)]),
            (json::json!("b.e.length"), vec![json::json!(4)]),
            (json::json!(r#"b["some:thing"]"#), vec![json::json!("else")]),
            (json::json!("b['some:thing']"), vec![json::json!("else")]),
            (json::json!("b[`some:thing`]"), vec![json::json!("else")]),
            (
                json::json!("match(b.foo, '^b([a-z])r$')"),
                vec![json::json!({"0": "bar", "1": "a"})],
            ),
            (
                json::json!("match(b.foo, '^(?P<first>b)([a-z])(?P<last>r)$')"),
                vec![json::json!({"0": "bar", "first": "b", "2": "a", "last": "r"})],
            ),
            (
                json::json!("match(b.foo, '^b([a-z])r$')['1']"),
                vec![json::json!("a")],
            ),
            (json::json!(r#""foo-bar""#), vec![json::json!("foo-bar")]),
            (json::json!("'foo-bar'"), vec![json::json!("foo-bar")]),
            (json::json!("join(b.e, '-')"), vec![json::json!("5-6-7-8")]),
            (
                json::json!({"z": 42, "dees": r#"json_path("c.*.d")"#}),
                vec![json::json!({"z": 42, "dees": [1, 2, 3]})],
            ),
            (json::json!("collect(a, 3)"), vec![json::json!(3)]),
            (
                json::json!("collect(b.e, 39)"),
                vec![json::json!([5, 6, 7, 8])],
            ),
            (json::json!("c[0].d + 1"), vec![json::json!(2)]),
            (json::json!("c[0].d - 1"), vec![json::json!(0)]),
            (json::json!("c[0].d * 1"), vec![json::json!(1)]),
            (json::json!("c[0].d / 2"), vec![json::json!(0.5)]),
            (json::json!("c[0].d + 2 * 2"), vec![json::json!(5)]),
            (json::json!("(c[0].d + 2) * 2"), vec![json::json!(6)]),
        ];

        for (i, (select, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            let select = Select::simple(select, Block, None, None, None);
            check_results(select, data, &expect, i);
        }
    }

    #[test]
    fn voe_stream() {
        let data = btreemap! {
            "a" => json::json!(3),
            "b" => json::json!({ "foo": "bar", "some:thing": "else", "e": [5, 6, 7, 8] }),
            "c" => json::json!([
                { "d": 1 },
                { "d": 2 },
                { "d": 3 },
            ]),
            "c2" => json::json!([[
                { "d": 1 },
                { "d": 2 },
                { "d": 3 },
            ]]),
        };

        current_thread::run(lazy(move || {
            let providers: Arc<_> = data
                .into_iter()
                .map(move |(k, v)| {
                    let p = match v {
                        json::Value::Array(v) => literals(v),
                        _ => literals(vec![v]),
                    };
                    (k.to_string(), p)
                })
                .collect::<BTreeMap<_, _>>()
                .into();

            let tests = vec![
                (
                    "collect(c, 3)",
                    json::json!([
                        { "d": 1 },
                        { "d": 2 },
                        { "d": 3 },
                    ]),
                ),
                ("c", json::json!({ "d": 1 })),
                ("collect(a, 3)", json::json!([3, 3, 3])),
                ("repeat(2)", json::json!([null, null])),
                ("true && false", false.into()),
                ("((true || false))", true.into()),
                ("c2[0].d", json::json!(1)),
                ("(c2[0].d)", json::json!(1)),
                (r#"json_path("c2.*.d")"#, json::json!([1, 2, 3])),
                ("c2.length", json::json!(3)),
                ("b.e.length", json::json!(4)),
                (r#"b["some:thing"]"#, json::json!("else")),
                ("b['some:thing']", json::json!("else")),
                ("b[`some:thing`]", json::json!("else")),
                (
                    "match(b.foo, '^b([a-z])r$')",
                    json::json!({"0": "bar", "1": "a"}),
                ),
                (
                    "match(b.foo, '^(?P<first>b)([a-z])(?P<last>r)$')",
                    json::json!({"0": "bar", "first": "b", "2": "a", "last": "r"}),
                ),
                ("match(b.foo, '^b([a-z])r$')['1']", json::json!("a")),
                (r#""foo-bar""#, json::json!("foo-bar")),
                ("'foo-bar'", json::json!("foo-bar")),
                ("join(b.e, '-')", json::json!("5-6-7-8")),
            ];

            let mut required_providers = RequiredProviders::new();
            let static_vars = BTreeMap::new();
            let mut futures = Vec::new();
            for (i, (expr, expect)) in tests.into_iter().enumerate() {
                let marker = create_marker();
                let voe = ValueOrExpression::new(
                    expr,
                    &mut required_providers,
                    &static_vars,
                    false,
                    marker,
                )
                .unwrap();
                let fut = voe
                    .into_stream(&providers, false)
                    .map(|(v, _)| v)
                    .into_future()
                    .map(move |(v, _)| {
                        assert_eq!(v, Some(expect), "index {}", i);
                    });
                futures.push(fut);
            }
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn r#where() {
        let data = json::json!({
            "three": 3,
            "empty_object": {},
            "empty_array": [],
        });

        let three = vec![json::json!(3)];
        let empty = Vec::new();

        // (where clause, expected out data)
        let check_table = vec![
            (
                "empty_array.length > 0 && empty_array[0].foo == 'foo'",
                &empty,
            ),
            ("0 == 0 && 1 == 1", &three),
            ("three > 2", &three),
            ("three > 3", &empty),
            ("three < 4", &three),
            ("three < 2", &empty),
            ("three != 2", &three),
            ("three != 3", &empty),
            ("three >= 3", &three),
            ("three >= 4", &empty),
            ("three <= 3", &three),
            ("three <= 2", &empty),
            ("three == 3", &three),
            ("three == 4", &empty),
            ("true", &three),
            ("false", &empty),
            ("1 > 2", &empty),
            ("''", &empty),
            ("'beep'", &three),
            ("empty_object", &three),
            ("empty_array", &three),
            ("0", &empty),
            ("0.0", &empty),
            ("-3", &three),
            ("true && false", &empty),
            ("false || true", &three),
            ("true && false || true", &three),
            ("true && (false || true)", &three),
            ("(true && false) || true", &three),
            ("true && false || true", &three),
            ("false || true && false", &empty),
            ("false || (true || false) && false", &empty),
            ("0 || (1 && false) && 2", &empty),
            ("false || (true || false) && true", &three),
        ];

        for (i, (where_clause, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            let select = Select::simple("three", Block, None, Some(where_clause), None);
            check_results(select, data, expect, i);
        }
    }

    #[test]
    fn for_each() {
        let data = json::json!({
            "a": 3,
            "b": { "foo": "bar" },
            "c": [
                { "d": 1 },
                { "d": 2 },
                { "d": 3 },
            ]
        });

        // (statement, expect)
        let check_table = vec![
            (
                Select::simple("a", Block, Some(vec!["repeat(5)"]), None, None),
                vec![
                    json::json!(3),
                    json::json!(3),
                    json::json!(3),
                    json::json!(3),
                    json::json!(3),
                ],
            ),
            (
                Select::simple(
                    "for_each[1]",
                    Block,
                    Some(vec!["repeat(3)", "true || false"]),
                    None,
                    None,
                ),
                vec![true.into(), true.into(), true.into()],
            ),
            (
                Select::simple(
                    "for_each[0]",
                    Block,
                    Some(vec!["json_path('c.*.d')"]),
                    None,
                    None,
                ),
                vec![json::json!(1), json::json!(2), json::json!(3)],
            ),
            (
                Select::simple("for_each[0]", Block, Some(vec!["c"]), None, None),
                vec![
                    json::json!({ "d": 1 }),
                    json::json!({ "d": 2 }),
                    json::json!({ "d": 3 }),
                ],
            ),
            (
                Select::simple(
                    "for_each[1]",
                    Block,
                    Some(vec!["repeat(2)", r#"json_path("c.*.d")"#]),
                    None,
                    None,
                ),
                vec![
                    json::json!(1),
                    json::json!(2),
                    json::json!(3),
                    json::json!(1),
                    json::json!(2),
                    json::json!(3),
                ],
            ),
        ];

        for (i, (select, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            check_results(select, data, &expect, i);
        }
    }
}
