use crate::{
    configv2::PropagateVars,
    error::{EvalExprError, IntoStreamError, VarsError},
    scripting,
    templating::{Bool, False, Regular, Template, True},
};
use ether::Either;
use futures::{Stream, StreamExt, TryStreamExt};
use log::debug;
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error as StdError,
    sync::Arc,
    task::Poll,
};

#[derive(Debug, Deserialize, PartialEq, Eq, serde::Serialize)]
pub enum Declare<VD: Bool> {
    #[serde(rename = "x")]
    Expr(Template<String, Regular, VD>),
    #[serde(rename = "c")]
    Collects {
        collects: Vec<Collect<VD>>,
        then: Template<String, Regular, VD>,
    },
}

#[derive(Debug, Deserialize, PartialEq, Eq, serde::Serialize)]
pub struct Collect<VD: Bool> {
    /// How many values to take.
    take: Take,
    /// Where to take values from.
    from: Template<String, Regular, VD>,
    /// Name to refer to the resulting array as.
    r#as: String,
}

impl PropagateVars for Collect<False> {
    type Data<VD: Bool> = Collect<VD>;

    fn insert_vars(
        self,
        vars: &crate::configv2::Vars<True>,
    ) -> Result<Self::Data<True>, VarsError> {
        Ok(Collect {
            take: self.take,
            from: self.from.insert_vars(vars)?,
            r#as: self.r#as,
        })
    }
}

/// Data for how many values should be taken from underlying source each yield.
#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(untagged)]
#[derive(serde::Serialize)]
enum Take {
    Fixed(usize),
    Rand(usize, usize),
}

impl Take {
    fn next_size(&self) -> usize {
        use rand::prelude::*;
        match self {
            Self::Fixed(x) => *x,
            Self::Rand(min, max) => thread_rng().gen_range(*min..*max),
        }
    }

    /// Maximum size that this Take represents.
    /// Used to ensure single allocation of Vec
    fn max(&self) -> usize {
        match self {
            Self::Fixed(x) => *x,
            Self::Rand(_, max) => *max,
        }
    }

    /// Create a Stream that takes multiple `Ok`s from the input stream.
    fn collect_stream<E, S: Stream<Item = Result<(T, Vec<Ar>), E>> + Unpin, T, Ar>(
        self,
        mut s: S,
    ) -> impl Stream<Item = Result<(Vec<T>, Vec<Ar>), E>> {
        use std::mem::{replace, take};

        let mut cache = Vec::with_capacity(self.max());
        let mut ars = vec![];
        let mut size = self.next_size();
        futures::stream::poll_fn(move |ctx| match s.poll_next_unpin(ctx) {
            // TODO: check why try scripts hang on collect
            Poll::Pending => {
                log::debug!("declare Take::collect_string Poll::Pending");
                Poll::Pending
            }
            Poll::Ready(Some(Ok((v, a)))) => {
                log::debug!("declare Take::collect_string Poll::Ready Ok cache.len: {}, size: {}, a.len: {}", cache.len(), size, a.len());
                cache.push(v);
                ars.extend(a);
                if cache.len() >= size {
                    size = self.next_size();
                    log::debug!(
                        "declare Take::collect_string Poll::Ready - next_size: {}, ars.len: {}",
                        size,
                        ars.len()
                    );
                    Poll::Ready(Some(Ok((
                        replace(&mut cache, Vec::with_capacity(size)),
                        take(&mut ars),
                    ))))
                } else {
                    log::debug!("declare Take::collect_string Poll::Ready else Poll::Pending");
                    Poll::Pending
                }
            }
            Poll::Ready(Some(Err(e))) => {
                log::debug!("declare Take::collect_string Poll::Ready Err");
                // Don't clear cache, because an Ok() may be
                // yielded later.
                Poll::Ready(Some(Err(e)))
            }
            Poll::Ready(None) => {
                log::debug!("declare Take::collect_string Poll::Ready None");
                // Underlying stream has finished; yield any
                // cached values, or return None.
                Poll::Ready((!cache.is_empty()).then(|| Ok((take(&mut cache), take(&mut ars)))))
            }
        })
    }
}

impl PropagateVars for Declare<False> {
    type Data<VD: Bool> = Declare<VD>;

    fn insert_vars(
        self,
        vars: &crate::configv2::Vars<True>,
    ) -> Result<Self::Data<True>, VarsError> {
        match self {
            Self::Expr(t) => t.insert_vars(vars).map(Self::Data::Expr),
            Self::Collects { collects, then } => Ok(Self::Data::Collects {
                collects: collects.insert_vars(vars)?,
                then: then.insert_vars(vars)?,
            }),
        }
    }
}

impl Declare<True> {
    pub fn get_required_providers(&self) -> BTreeSet<Arc<str>> {
        match self {
            Self::Expr(t) => t.get_required_providers(),
            Self::Collects { collects, then } => {
                let ases: BTreeSet<_> = collects.iter().map(|c| c.r#as.as_str()).collect();
                collects
                    .iter()
                    .flat_map(|c| c.from.get_required_providers())
                    .chain(
                        then.get_required_providers()
                            .into_iter()
                            .filter(|k| !ases.contains::<str>(k)),
                    )
                    .collect()
            }
        }
    }

    pub fn into_stream<P, Ar, E>(
        self,
        providers: Arc<BTreeMap<Arc<str>, P>>,
    ) -> Result<
        impl Stream<Item = Result<(serde_json::Value, Vec<Ar>), E>> + Send + 'static,
        IntoStreamError,
    >
    where
        P: scripting::ProviderStream<Ar, Err = E> + Clone + 'static,
        Ar: Clone + Send + Unpin + 'static,
        E: StdError + Send + Clone + Unpin + 'static + From<EvalExprError>,
    {
        debug!(
            "Declare into_stream declare={:?}, providers={:?}",
            self,
            providers.keys()
        );
        // poll_fn stream is not Clone, so an abstraction is made over a clonable stream vs a
        // function that returns a non-clonable stream
        fn make_stream<S: Clone, F: Fn() -> S2, S2>(e: &Either<S, F>) -> Either<S, S2> {
            match e {
                Either::A(s) => Either::A(s.clone()),
                Either::B(f) => Either::B(f()),
            }
        }
        let stream = match self {
            Self::Expr(t) => t.into_stream(providers).map(Either::A),
            Self::Collects { collects, then } => {
                let collects = collects
                    .into_iter()
                    .map(|Collect { take, from, r#as }| {
                        let providers = providers.clone();
                        let stream = {
                            debug!(
                                "Declare Collects take={:?}, from={:?} as={}",
                                take, from, r#as
                            );
                            match from.as_static().map(ToOwned::to_owned) {
                                // collect does not need providers, so just repeat the same value
                                // as needed
                                Some(v) => Either::A(futures::stream::repeat_with(move || {
                                    Ok((
                                        vec![
                                            serde_json::Value::String(v.clone());
                                            take.next_size()
                                        ],
                                        vec![],
                                    ))
                                })),
                                // collect does need providers, so make a stream combinator to
                                // gather and yield values
                                None => Either::B({
                                    let _ = from.clone().into_stream(Arc::clone(&providers))?;
                                    move || {
                                        take.collect_stream(
                                            from.clone()
                                                .into_stream(Arc::clone(&providers))
                                                .expect("just checked"),
                                        )
                                    }
                                }),
                            }
                        };
                        Ok((r#as, move || make_stream(&stream)))
                    })
                    .collect::<Result<BTreeMap<_, _>, _>>()?;
                let collects = Arc::new(collects);
                then.into_stream_with(move |pn| {
                    providers.get(pn).map(|p| p.as_stream()).or_else(|| {
                        collects.get(pn).map(|p| {
                            let p = p();
                            let p = p.map_ok(|(val, ar)| (val.into(), ar));
                            Box::new(p)
                                as Box<
                                    dyn Stream<Item = Result<(serde_json::Value, Vec<Ar>), E>>
                                        + Send
                                        + Unpin,
                                >
                        })
                    })
                })
                .map(Either::B)
            }
        }?;
        Ok(stream.map_ok(|(v, ar)| {
            (
                match v {
                    serde_json::Value::String(s) => match serde_json::from_str(&s) {
                        Ok(serde_json::Value::String(s)) => {
                            log::debug!("Using literal string {s:?} as the json value");
                            serde_json::Value::String(s)
                        }
                        Ok(v) => v,
                        Err(e) => {
                            log::debug!("String {s:?} is not valid JSON ({e}); reusing same string value");
                            serde_json::Value::String(s)
                        }
                    },
                    other => other,
                },
                ar,
            )
        }))
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        configv2::VarValue,
        templating::{ExprSegment, TryDefault},
    };

    use super::*;
    use serde_yaml::from_str as from_yaml;

    #[test]
    fn basic() {
        let input = "!x expr";

        let decl = from_yaml::<Declare<False>>(input)
            .unwrap()
            .insert_vars(&BTreeMap::new())
            .unwrap();
        assert_eq!(decl, Declare::Expr(Template::new_literal("expr".into())));
    }

    #[test]
    fn collects() {
        let input = r#"!c
        collects:
          - take: 3
            from: ${p:a}
            as: _a
        then: ${p:_a}"#;
        let decl = from_yaml::<Declare<False>>(input)
            .unwrap()
            .insert_vars(&BTreeMap::new())
            .unwrap();
        assert_eq!(
            decl,
            Declare::Collects {
                collects: vec![Collect {
                    take: Take::Fixed(3),
                    from: Template::NeedsProviders {
                        script: vec![ExprSegment::ProvDirect("a".into())],
                        __dontuse: (True, True, True)
                    },
                    r#as: "_a".into()
                }],
                then: Template::NeedsProviders {
                    script: vec![ExprSegment::ProvDirect("_a".into())],
                    __dontuse: TryDefault::try_default().unwrap()
                }
            }
        );
        let input = r#"!c
        collects:
          - take: 3
            from: ${p:a}
            as: _a
          - take: [4, 7]
            from: ${p:b}
            as: _b
          - take: 3
            from: ${v:c}
            as: _c
        then: ${p:_a}${p:_b}${p:_c}"#;
        let decl = from_yaml::<Declare<False>>(input)
            .unwrap()
            .insert_vars(&BTreeMap::from([(
                "c".into(),
                VarValue::Str(Template::new_literal("foo".into())),
            )]))
            .unwrap();
        assert_eq!(
            decl,
            Declare::Collects {
                collects: vec![
                    Collect {
                        take: Take::Fixed(3),
                        from: Template::NeedsProviders {
                            script: vec![ExprSegment::ProvDirect("a".into())],
                            __dontuse: (True, True, True)
                        },
                        r#as: "_a".into()
                    },
                    Collect {
                        take: Take::Rand(4, 7),
                        from: Template::NeedsProviders {
                            script: vec![ExprSegment::ProvDirect("b".into())],
                            __dontuse: (True, True, True)
                        },
                        r#as: "_b".into()
                    },
                    Collect {
                        take: Take::Fixed(3),
                        from: Template::new_literal("foo".into()),
                        r#as: "_c".into()
                    }
                ],
                then: Template::NeedsProviders {
                    script: vec![
                        ExprSegment::ProvDirect("_a".into()),
                        ExprSegment::ProvDirect("_b".into()),
                        ExprSegment::ProvDirect("_c".into()),
                    ],
                    __dontuse: TryDefault::try_default().unwrap()
                }
            }
        );
    }
}
