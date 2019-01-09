use super::{EndpointProvidesPreProcessed, EndpointProvidesSendOptions};
use crate::channel;
use crate::config;
use crate::providers;
use crate::template::{json_value_to_string, textify, TextifyReturn, TextifyReturnFn};
use crate::util::{parse_provider_name, Either, Either3};

use futures::{future, stream, Future, IntoFuture, Stream};
use handlebars::Handlebars;
use itertools::Itertools;
use pest::{
    iterators::{Pair, Pairs},
    Parser as PestParser,
};
use pest_derive::Parser;
use rand::distributions::{Distribution, Uniform};
use regex::Regex;
use serde_json as json;

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    iter,
    sync::Arc,
};

pub type AutoReturn = (
    config::EndpointProvidesSendOptions,
    channel::Sender<json::Value>,
    Vec<json::Value>,
);

enum DeclareError {
    ProviderEnded(String),
    UnknownProvider(String),
}

struct MatchHelper {
    capture_names: Vec<String>,
    regex: Regex,
}

impl MatchHelper {
    fn new(regex_str: &str) -> Result<Self, regex::Error> {
        let regex = Regex::new(regex_str)?;
        let capture_names = regex
            .capture_names()
            .enumerate()
            .map(|(i, n)| n.map(|s| s.into()).unwrap_or_else(|| i.to_string()))
            .collect();
        Ok(MatchHelper {
            capture_names,
            regex,
        })
    }

    fn run(&self, search_str: &str) -> json::Value {
        if let Some(captures) = self.regex.captures(search_str) {
            let map: json::Map<String, json::Value> = self
                .capture_names
                .iter()
                .zip(captures.iter())
                .map(|(name, capture)| {
                    let key = name.clone();
                    let value = capture
                        .map(|c| c.as_str().into())
                        .unwrap_or(json::Value::Null);
                    (key, value)
                })
                .collect();
            map.into()
        } else {
            json::Value::Null
        }
    }
}

#[derive(Clone)]
enum FunctionArg {
    FunctionCall(FunctionCall),
    Value(Value),
}

impl FunctionArg {
    fn evaluate<'a, 'b: 'a>(&'b self, d: &'a json::Value) -> Cow<'a, json::Value> {
        match self {
            FunctionArg::FunctionCall(fc) => Cow::Owned(fc.evaluate(d)),
            FunctionArg::Value(v) => v.evaluate(d),
        }
    }

    fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> Box<dyn Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> + Sync + Send>
    {
        let f = match self {
            FunctionArg::FunctionCall(fc) => Either::A(fc.evaluate_as_future(providers)),
            FunctionArg::Value(v) => Either::B(v.evaluate_as_future(providers)),
        };
        // boxed to prevent recursive impl Future
        Box::new(f)
    }
}

type GetN = Box<Fn() -> u64 + Send + Sync>;

#[derive(Clone)]
enum FunctionCall {
    Collect(Arc<(FunctionArg, GetN)>),
    JsonPath(Arc<(String, jsonpath::Selector)>),
    Match(Arc<(FunctionArg, MatchHelper)>),
    Repeat(Arc<GetN>),
}

impl FunctionCall {
    fn new(
        ident: &str,
        args: Vec<FunctionArg>,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Either<Self, json::Value> {
        if ident == "collect" {
            FunctionCall::new_collect(args)
        } else if ident == "json_path" {
            FunctionCall::new_json_path(args, providers, static_providers)
        } else if ident == "repeat" {
            FunctionCall::new_repeat(args)
        } else if ident == "match" {
            FunctionCall::new_match(args)
        } else {
            panic!("unknown function reference `{}`", ident);
        }
    }

    fn new_json_path(
        args: Vec<FunctionArg>,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Either<Self, json::Value> {
        match args.as_slice() {
            [FunctionArg::Value(Value::Json(false, json::Value::String(json_path)))] => {
                let provider = parse_provider_name(&*json_path);
                // jsonpath requires the query to start with `$.`, so add it in
                let json_path = format!("$.{}", json_path);
                let json_path = jsonpath::Selector::new(&*json_path)
                    .unwrap_or_else(|e| panic!("invalid json path query, {}\n{:?}", json_path, e));
                let ret = if let Some(v) = static_providers.get(provider) {
                    let r = json_path.find(v);
                    Either::B(json::Value::Array(r.cloned().collect()))
                } else {
                    Either::A(FunctionCall::JsonPath(Arc::new((
                        provider.into(),
                        json_path,
                    ))))
                };
                providers.insert(provider.into());
                ret
            }
            _ => panic!("invalid arguments for json_path"),
        }
    }

    fn new_collect(mut args: Vec<FunctionArg>) -> Either<Self, json::Value> {
        let as_u64 = |fa| match fa {
            FunctionArg::Value(Value::Json(false, json::Value::Number(ref n))) if n.is_u64() => {
                n.as_u64().unwrap()
            }
            _ => panic!("invalid arguments for repeat"),
        };
        match args.len() {
            2 | 3 => {
                let second = as_u64(args.remove(1));
                let first = args.remove(0);
                let third = args.pop().map(|fa| {
                    let max = as_u64(fa);
                    Uniform::new_inclusive(second, max)
                });
                let func = move || -> u64 {
                    if let Some(random) = third {
                        random.sample(&mut rand::thread_rng())
                    } else {
                        second
                    }
                };
                Either::A(FunctionCall::Collect(Arc::new((first, Box::new(func)))))
            }
            _ => panic!("invalid arguments for repeat"),
        }
    }

    fn new_repeat(mut args: Vec<FunctionArg>) -> Either<Self, json::Value> {
        let as_u64 = |fa| match fa {
            FunctionArg::Value(Value::Json(false, json::Value::Number(ref n))) if n.is_u64() => {
                n.as_u64().unwrap()
            }
            _ => panic!("invalid arguments for repeat"),
        };
        match args.len() {
            1 | 2 => {
                let first = as_u64(args.remove(0));
                let second = args.pop().map(|fa| {
                    let max = as_u64(fa);
                    Uniform::new_inclusive(first, max)
                });
                let func = move || -> u64 {
                    if let Some(random) = second {
                        random.sample(&mut rand::thread_rng())
                    } else {
                        first
                    }
                };
                Either::A(FunctionCall::Repeat(Arc::new(Box::new(func))))
            }
            _ => panic!("invalid arguments for repeat"),
        }
    }

    fn new_match(args: Vec<FunctionArg>) -> Either<Self, json::Value> {
        match args.as_slice() {
            [FunctionArg::Value(_), FunctionArg::Value(Value::Json(false, json::Value::String(regex_str)))] =>
            {
                let m = MatchHelper::new(regex_str).unwrap();
                Either::A(FunctionCall::Match(Arc::new((
                    args.into_iter().nth(0).unwrap(),
                    m,
                ))))
            }
            _ => panic!("invalid arguments for match"),
        }
    }

    fn evaluate(&self, d: &json::Value) -> json::Value {
        match self {
            FunctionCall::Collect(c) => c.0.evaluate(d).into_owned(),
            FunctionCall::JsonPath(jp) => {
                let result = jp.1.find(d);
                let v = result.cloned().collect();
                json::Value::Array(v)
            }
            FunctionCall::Match(m) => {
                let d = m.0.evaluate(d);
                m.1.run(&json_value_to_string(&d))
            }
            FunctionCall::Repeat(r) => {
                let n = r();
                json::Value::Array(iter::repeat(json::Value::Null).take(n as usize).collect())
            }
        }
    }

    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        match self {
            FunctionCall::Collect(c) => Either3::B(iter::once(c.0.evaluate(d).into_owned())),
            FunctionCall::JsonPath(jp) => {
                let result = jp.1.find(d);
                let v: Vec<_> = result.cloned().collect();
                Either3::A(v.into_iter())
            }
            FunctionCall::Match(m) => {
                let d = m.0.evaluate(d);
                let json = m.1.run(&json_value_to_string(&d));
                Either3::B(iter::once(json))
            }
            FunctionCall::Repeat(r) => {
                let n = r();
                Either3::C(iter::repeat(json::Value::Null).take(n as usize))
            }
        }
    }

    fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        match self {
            FunctionCall::Collect(c) => {
                let n = c.1();
                let futures = (0..n).map(move |_| c.0.evaluate_as_future(providers));
                let a = stream::futures_ordered(futures)
                    .fold(
                        (Vec::new(), Vec::new()),
                        |(mut jsons, mut outgoing), (json, outgoing2)| {
                            jsons.push(json);
                            outgoing.extend(outgoing2);
                            Ok((jsons, outgoing))
                        },
                    )
                    .map(|(jsons, outgoing)| (jsons.into(), outgoing));
                Either3::A(a)
            }
            FunctionCall::JsonPath(jp) => {
                let b = providers
                    .get(&jp.0)
                    .map(move |p| {
                        let jp = jp.clone();
                        let jp2 = jp.clone();
                        let jp3 = jp.clone();
                        match p {
                            providers::Kind::Value(provider) => {
                                let auto_return = provider.auto_return;
                                let tx = provider.tx.clone();
                                provider
                                    .rx
                                    .clone()
                                    .into_future()
                                    .map_err(move |_| DeclareError::ProviderEnded(jp.0.clone()))
                                    .and_then(move |(v, _)| {
                                        v.ok_or_else(|| DeclareError::ProviderEnded(jp2.0.clone()))
                                    })
                                    .map(move |v| {
                                        let v = json::json!({ &*jp3.0: v });
                                        let result = jp3.1.find(&v);
                                        let mut outgoing = Vec::new();
                                        if let Some(ar) = auto_return {
                                            outgoing.push((ar, tx, vec![v.clone()]));
                                        }
                                        let v2: Vec<_> = result.cloned().collect();
                                        (v2.into(), outgoing)
                                    })
                            }
                        }
                    })
                    .ok_or_else(|| DeclareError::UnknownProvider(jp.0.clone()))
                    .into_future()
                    .flatten();
                Either3::B(b)
            }
            FunctionCall::Match(m) => {
                let m = m.clone();
                let c =
                    m.0.evaluate_as_future(providers)
                        .map(move |(d, returns)| (m.1.run(&json_value_to_string(&d)), returns));
                Either3::C(Either::A(c))
            }
            FunctionCall::Repeat(r) => {
                let n = r();
                let c = stream::repeat(json::Value::Null)
                    .take(n)
                    .collect()
                    .map(|v| (v.into(), Vec::new()));
                Either3::C(Either::B(c))
            }
        }
    }
}

fn index_json<'a>(
    json: &'a json::Value,
    index: Either<&JsonPathSegment, &str>,
) -> Cow<'a, json::Value> {
    #[allow(unused_assignments)]
    let mut holder = None;
    let str_or_number = match index {
        Either::A(jps) => match jps.evaluate(json) {
            Either::A(s) => {
                holder = Some(s);
                Either::A(holder.as_ref().unwrap().as_str())
            }
            Either::B(n) => Either::B(n),
        },
        Either::B(s) => Either::A(s),
    };
    let o = match (json, str_or_number) {
        (json::Value::Object(m), Either::A(s)) => m.get(s),
        (json::Value::Array(a), Either::B(n)) => a.get(n),
        (json::Value::Array(a), Either::A(s)) if s == "length" => {
            return Cow::Owned((a.len() as u64).into());
        }
        _ => panic!("cannot index into json {}", json),
    };
    Cow::Borrowed(o.unwrap_or(&json::Value::Null))
}

fn index_json2<'a>(mut json: &'a json::Value, indexes: &[JsonPathSegment]) -> json::Value {
    for (i, index) in indexes.iter().enumerate() {
        let o = match (json, index.evaluate(json)) {
            (json::Value::Object(m), Either::A(ref s)) => m.get(s),
            (json::Value::Array(a), Either::B(n)) => a.get(n),
            (json::Value::Array(a), Either::A(ref s)) if s == "length" => {
                let ret = (a.len() as u64).into();
                if i != indexes.len() - 1 {
                    panic!("cannot index into json {}", ret)
                }
                return ret;
            }
            _ => panic!("cannot index into json {}", json),
        };
        json = o.unwrap_or(&json::Value::Null)
    }
    json.clone()
}

#[derive(Clone)]
pub struct JsonPath {
    start: JsonPathStart,
    rest: Vec<JsonPathSegment>,
}

impl JsonPath {
    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        match &self.start {
            JsonPathStart::FunctionCall(fnc) => {
                let rest = self.rest.clone();
                Either::A(fnc.evaluate_as_iter(d).map(move |j| index_json2(&j, &rest)))
            }
            JsonPathStart::JsonIdent(s) => {
                let j = index_json(d, Either::B(s));
                Either::B(iter::once(index_json2(&j, &self.rest)))
            }
            JsonPathStart::Value(v) => Either::B(iter::once(v.clone())),
        }
    }

    fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        let rest = self.rest.clone();
        match self.start.clone() {
            JsonPathStart::FunctionCall(fnc) => Either3::A(
                fnc.evaluate_as_future(providers)
                    .map(move |(j, returns)| (index_json2(&j, &rest), returns)),
            ),
            JsonPathStart::JsonIdent(s) => {
                let s = Arc::new(s);
                let s2 = s.clone();
                let b = providers
                    .get(&*s2)
                    .map(move |p| {
                        let s = s2.clone();
                        match p {
                            providers::Kind::Value(provider) => {
                                let auto_return = provider.auto_return;
                                let tx = provider.tx.clone();
                                provider
                                    .rx
                                    .clone()
                                    .into_future()
                                    .map_err(move |_| DeclareError::ProviderEnded((&*s).clone()))
                                    .and_then(move |(v, _)| {
                                        v.map(move |v| {
                                            let mut outgoing = Vec::new();
                                            if let Some(ar) = auto_return {
                                                outgoing.push((ar, tx, vec![v.clone()]));
                                            }
                                            let v = index_json2(&v, &rest);
                                            (v, outgoing)
                                        })
                                        .ok_or_else(|| DeclareError::ProviderEnded((&*s2).clone()))
                                    })
                            }
                        }
                    })
                    .ok_or_else(move || DeclareError::UnknownProvider((&*s).clone()))
                    .into_future()
                    .flatten();
                Either3::B(b)
            }
            JsonPathStart::Value(v) => {
                let v = index_json2(&v, &rest);
                Either3::C(future::ok((v, Vec::new())))
            }
        }
    }
}

fn bool_value(json: &json::Value) -> bool {
    match json {
        json::Value::Null => false,
        json::Value::Bool(b) => *b,
        json::Value::Number(n) if n.is_i64() => n.as_i64().unwrap() != 0,
        json::Value::Number(n) if n.is_u64() => n.as_u64().unwrap() != 0,
        json::Value::Number(n) if n.is_f64() => n.as_f64().unwrap() != 0f64,
        json::Value::Number(_) => unreachable!("number that is not an integer or float"),
        json::Value::String(s) => !s.is_empty(),
        json::Value::Object(_) | json::Value::Array(_) => true,
    }
}

fn f64_value(json: &json::Value) -> f64 {
    if let Some(f) = json.as_f64() {
        f
    } else {
        std::f64::NAN
    }
}

#[derive(Clone)]
pub enum ValueOrComplexExpression {
    V(Value),
    Ce(ComplexExpression),
}

impl ValueOrComplexExpression {
    pub fn new(
        expr: &str,
        handlebars: &Arc<Handlebars>,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Self {
        let pairs = Select::parse(Rule::entry_point, expr).unwrap();
        let value = parse_complex_expression(pairs, handlebars, providers, static_providers);
        value.into()
    }

    fn evaluate<'a, 'b: 'a>(&'b self, d: &'a json::Value) -> Cow<'a, json::Value> {
        match self {
            ValueOrComplexExpression::V(v) => v.evaluate(d),
            ValueOrComplexExpression::Ce(ce) => Cow::Owned(ce.execute(d).into()),
        }
    }

    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        match self {
            ValueOrComplexExpression::V(v) => Either::A(v.evaluate_as_iter(d)),
            ValueOrComplexExpression::Ce(ce) => Either::B(iter::once(ce.execute(d).into())),
        }
    }

    pub fn into_stream(
        self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = ()> {
        let providers = providers.clone();
        let this = Arc::new(self);
        stream::repeat(())
            .and_then(move |_| match &*this {
                ValueOrComplexExpression::V(v) => Either::A(v.evaluate_as_future(&providers)),
                ValueOrComplexExpression::Ce(ce) => Either::B(
                    ce.execute_as_future(&providers)
                        .map(|(b, returns)| (b.into(), returns)),
                ),
            })
            .map(Either::A)
            .or_else(|d| {
                if let DeclareError::UnknownProvider(p) = d {
                    panic!("Unknown provider `{}`", p);
                }
                Ok(Either::B(()))
            })
            .take_while(|v| {
                if let Either::A(_) = v {
                    Ok(true)
                } else {
                    Ok(false)
                }
            })
            .map(|v| match v {
                Either::A(v) => v,
                _ => unreachable!(),
            })
    }
}

impl From<ComplexExpression> for ValueOrComplexExpression {
    fn from(mut ce: ComplexExpression) -> Self {
        match (ce.pieces.len(), ce.pieces.last_mut()) {
            (1, Some(Expression::Simple(se))) if se.rest.is_none() => {
                let value = std::mem::replace(&mut se.lhs, Value::Json(false, json::Value::Null));
                ValueOrComplexExpression::V(value)
            }
            (1, Some(Expression::Complex(_))) => {
                if let Some(Expression::Complex(ce)) = ce.pieces.pop() {
                    ce.into()
                } else {
                    unreachable!();
                }
            }
            _ => ValueOrComplexExpression::Ce(ce),
        }
    }
}

type Not = bool;

#[derive(Clone)]
pub enum Value {
    JsonPath(Not, JsonPath),
    Json(Not, json::Value),
    Template(Not, Arc<(BTreeSet<String>, Box<TextifyReturnFn>)>),
}

impl Value {
    fn from_string(
        s: String,
        not: bool,
        handlebars: Arc<Handlebars>,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Self {
        let mut providers2 = BTreeSet::new();
        match textify(s, handlebars, &mut providers2, static_providers) {
            TextifyReturn::Trf(t) => {
                providers.extend(providers2.clone());
                Value::Template(not, (providers2, t).into())
            }
            TextifyReturn::String(s) => Value::Json(not, s.into()),
        }
    }

    fn evaluate<'a, 'b: 'a>(&'b self, d: &'a json::Value) -> Cow<'a, json::Value> {
        let (not, v) = match self {
            Value::JsonPath(not, path) => {
                let mut v: Vec<_> = path.evaluate_as_iter(d).collect();
                let c = if v.is_empty() {
                    unreachable!("path should never return no elements");
                } else if v.len() == 1 {
                    Cow::Owned(v.pop().unwrap())
                } else {
                    Cow::Owned(json::Value::Array(v))
                };
                (*not, c)
            }
            Value::Json(not, value) => (*not, Cow::Borrowed(value)),
            Value::Template(not, t) => (*not, Cow::Owned(t.1(d))),
        };
        if not {
            Cow::Owned(json::Value::Bool(!bool_value(&v)))
        } else {
            v
        }
    }

    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        match self {
            Value::JsonPath(not, path) => {
                if *not {
                    Either3::C(iter::once(false.into()))
                } else {
                    Either3::A(
                        path.evaluate_as_iter(d)
                            .map(|v| {
                                if let json::Value::Array(v) = v {
                                    Either::A(v.into_iter())
                                } else {
                                    Either::B(iter::once(v))
                                }
                            })
                            .flatten(),
                    )
                }
            }
            _ => {
                let value = self.evaluate(d).into_owned();
                match value {
                    json::Value::Array(v) => Either3::B(v.into_iter()),
                    _ => Either3::C(iter::once(value)),
                }
            }
        }
    }

    fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        let (not, f) = match self {
            Value::JsonPath(not, path) => {
                let f = Either3::A(path.evaluate_as_future(providers));
                (*not, f)
            }
            Value::Json(not, value) => (*not, Either3::B(future::ok((value.clone(), Vec::new())))),
            Value::Template(not, t) => {
                let t = t.clone();
                let futures = t.0.clone().into_iter().map(move |s| {
                    providers
                        .clone()
                        .get(&s)
                        .map(|p| {
                            let s = Arc::new(s.clone());
                            let s2 = s.clone();
                            match p {
                                providers::Kind::Value(provider) => {
                                    let auto_return = provider.auto_return;
                                    let tx = provider.tx.clone();
                                    provider
                                        .rx
                                        .clone()
                                        .into_future()
                                        .map_err(move |_| {
                                            DeclareError::ProviderEnded((&*s).clone())
                                        })
                                        .and_then(move |(v, _)| {
                                            v.map(|v| {
                                                let mut outgoing = Vec::new();
                                                if let Some(ar) = auto_return {
                                                    outgoing.push((ar, tx, vec![v.clone()]));
                                                }
                                                ((&*s2).clone(), v, outgoing)
                                            })
                                            .ok_or_else(|| {
                                                DeclareError::ProviderEnded((&*s2).clone())
                                            })
                                        })
                                }
                            }
                        })
                        .ok_or_else(|| DeclareError::UnknownProvider(s.clone()))
                        .into_future()
                        .flatten()
                });
                let f = stream::futures_unordered(futures).collect().map(move |v| {
                    let (map, returns) = v.into_iter().fold(
                        (json::Map::new(), Vec::new()),
                        |(mut map, mut returns), (key, value, returns2)| {
                            map.insert(key, value);
                            returns.extend(returns2);
                            (map, returns)
                        },
                    );
                    let json = map.into();
                    (t.1(&json), returns)
                });
                (*not, Either3::C(f))
            }
        };
        f.map(move |(v, returns)| {
            let v = if not {
                json::Value::Bool(!bool_value(&v))
            } else {
                v
            };
            (v, returns)
        })
    }
}

#[derive(Clone)]
enum JsonPathSegment {
    Number(usize),
    String(String),
    Template(Arc<(BTreeSet<String>, Box<TextifyReturnFn>)>),
}

impl JsonPathSegment {
    fn from_string(
        s: String,
        handlebars: Arc<Handlebars>,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Self {
        let mut providers2 = BTreeSet::new();
        match textify(s, handlebars, &mut providers2, static_providers) {
            TextifyReturn::Trf(t) => {
                providers.extend(providers2.clone());
                JsonPathSegment::Template((providers2, t).into())
            }
            TextifyReturn::String(s) => JsonPathSegment::String(s),
        }
    }

    fn evaluate(&self, d: &json::Value) -> Either<String, usize> {
        match self {
            JsonPathSegment::Number(n) => Either::B(*n),
            JsonPathSegment::String(s) => Either::A(s.clone()),
            JsonPathSegment::Template(t) => Either::A(json_value_to_string(&t.1(d)).into_owned()),
        }
    }
}

#[derive(Clone)]
enum JsonPathStart {
    FunctionCall(FunctionCall),
    JsonIdent(String),
    Value(json::Value),
}

#[derive(Clone, PartialEq)]
enum Combiner {
    And,
    Or,
}

#[derive(Clone)]
enum Operator {
    Eq,
    Gt,
    Gte,
    Lt,
    Lte,
    Ne,
}

#[derive(Clone)]
enum Expression {
    Complex(ComplexExpression),
    Simple(SimpleExpression),
}

impl Expression {
    fn execute<'a>(&self, d: &'a json::Value) -> bool {
        match self {
            Expression::Complex(c) => c.execute(d),
            Expression::Simple(s) => s.execute(d),
        }
    }

    fn execute_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> Box<dyn Future<Item = (bool, Vec<AutoReturn>), Error = DeclareError> + Send + Sync> {
        let f = match self {
            Expression::Complex(c) => Either::A(c.execute_as_future(providers)),
            Expression::Simple(s) => Either::B(s.execute_as_future(providers)),
        };
        // boxed to prevent recursive impl Future
        Box::new(f)
    }
}

#[derive(Clone)]
pub struct ComplexExpression {
    combiner: Combiner,
    pieces: Vec<Expression>,
}

impl ComplexExpression {
    fn execute(&self, d: &json::Value) -> bool {
        match self.combiner {
            Combiner::And => self.pieces.iter().all(|e| e.execute(d)),
            Combiner::Or => self.pieces.iter().any(|e| e.execute(d)),
        }
    }

    fn execute_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (bool, Vec<AutoReturn>), Error = DeclareError> {
        let futures = self
            .pieces
            .iter()
            .map(move |e| e.execute_as_future(providers));
        let stream = stream::futures_ordered(futures);
        match self.combiner {
            Combiner::And => {
                let pieces_len = self.pieces.len();
                let fut = stream
                    .fold(
                        (0, Vec::new()),
                        |(mut count, mut returns), (b, returns2)| {
                            returns.extend(returns2);
                            if b {
                                count += 1;
                            }
                            Ok((count, returns))
                        },
                    )
                    .map(move |(count, returns)| (count == pieces_len, returns));
                Either::A(fut)
            }
            Combiner::Or => Either::B(stream.fold(
                (false, Vec::new()),
                |(mut saw_true, mut returns), (b, returns2)| {
                    returns.extend(returns2);
                    if b {
                        saw_true = true;
                    }
                    Ok((saw_true, returns))
                },
            )),
        }
    }
}

#[derive(Clone)]
struct SimpleExpression {
    lhs: Value,
    rest: Option<(Operator, Value)>,
}

impl SimpleExpression {
    fn execute(&self, d: &json::Value) -> bool {
        let left = self.lhs.evaluate(d);
        if let Some((operator, right_value)) = &self.rest {
            let right = right_value.evaluate(d);
            match operator {
                Operator::Eq => left.eq(&right),
                Operator::Gt => f64_value(&left) > f64_value(&right),
                Operator::Gte => f64_value(&left) >= f64_value(&right),
                Operator::Lt => f64_value(&left) < f64_value(&right),
                Operator::Lte => f64_value(&left) <= f64_value(&right),
                Operator::Ne => left.ne(&right),
            }
        } else {
            bool_value(&left)
        }
    }

    fn execute_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (bool, Vec<AutoReturn>), Error = DeclareError> {
        let left = self.lhs.evaluate_as_future(providers);
        if let Some((operator, right_value)) = self.rest.clone() {
            let right = right_value.evaluate_as_future(providers);
            let a =
                left.join(right)
                    .map(move |((left_val, mut returns), (right_val, returns2))| {
                        returns.extend(returns2);
                        let b = match operator {
                            Operator::Eq => left_val.eq(&right_val),
                            Operator::Gt => f64_value(&left_val) > f64_value(&right_val),
                            Operator::Gte => f64_value(&left_val) >= f64_value(&right_val),
                            Operator::Lt => f64_value(&left_val) < f64_value(&right_val),
                            Operator::Lte => f64_value(&left_val) <= f64_value(&right_val),
                            Operator::Ne => left_val.ne(&right_val),
                        };
                        (b, returns)
                    });
            Either::A(a)
        } else {
            let b = left.map(|(value, returns)| (bool_value(&value), returns));
            Either::B(b)
        }
    }
}

#[derive(Clone)]
enum ParsedSelect {
    Null,
    Bool(bool),
    Number(json::Number),
    Expression(ValueOrComplexExpression),
    Array(Vec<ParsedSelect>),
    Object(Vec<(String, ParsedSelect)>),
}

impl ParsedSelect {
    fn evaluate(&self, d: &json::Value) -> json::Value {
        match self {
            ParsedSelect::Null => json::Value::Null,
            ParsedSelect::Bool(b) => json::Value::Bool(*b),
            ParsedSelect::Number(n) => json::Value::Number(n.clone()),
            ParsedSelect::Expression(v) => v.evaluate(d).into_owned(),
            ParsedSelect::Array(v) => {
                let v = v.iter().map(|p| p.evaluate(d)).collect();
                json::Value::Array(v)
            }
            ParsedSelect::Object(v) => {
                let m = v.iter().map(|(k, v)| (k.clone(), v.evaluate(d))).collect();
                json::Value::Object(m)
            }
        }
    }
}

pub const REQUEST_STARTLINE: u16 = 0b000_000_100;
pub const REQUEST_HEADERS: u16 = 0b000_000_010;
pub const REQUEST_BODY: u16 = 0b000_000_001;
const REQUEST_ALL: u16 = REQUEST_STARTLINE | REQUEST_HEADERS | REQUEST_BODY;
pub const RESPONSE_STARTLINE: u16 = 0b000_100_000;
pub const RESPONSE_HEADERS: u16 = 0b000_010_000;
pub const RESPONSE_BODY: u16 = 0b000_001_000;
const RESPONSE_ALL: u16 = RESPONSE_STARTLINE | RESPONSE_HEADERS | RESPONSE_BODY;
const FOR_EACH: u16 = 0b001_000_000;
pub const STATS: u16 = 0b010_000_000;
pub const REQUEST_URL: u16 = 0b100_000_000;

#[derive(Clone, Parser)]
#[grammar = "config/select.pest"]
pub struct Select {
    join: Vec<ValueOrComplexExpression>,
    providers: BTreeSet<String>,
    special_providers: u16,
    send_behavior: EndpointProvidesSendOptions,
    select: ParsedSelect,
    where_clause: Option<ComplexExpression>,
    where_clause_special_providers: u16,
}

fn providers_helper(incoming: &mut BTreeSet<String>, bitwise: &mut u16) {
    let previous = std::mem::replace(incoming, Default::default());
    for provider in previous.into_iter() {
        match provider.as_ref() {
            "request.start-line" => *bitwise |= REQUEST_STARTLINE,
            "request.headers" => *bitwise |= REQUEST_HEADERS,
            "request.body" => *bitwise |= REQUEST_BODY,
            "request.method" => (),
            "request.url" => *bitwise |= REQUEST_URL,
            "request" => *bitwise |= REQUEST_ALL,
            "response.start-line" => *bitwise |= RESPONSE_STARTLINE,
            "response.headers" => *bitwise |= RESPONSE_HEADERS,
            "response.body" => *bitwise |= RESPONSE_BODY,
            "response" => *bitwise |= RESPONSE_ALL,
            "response.status" => (),
            "stats" => *bitwise |= STATS,
            "for_each" => *bitwise |= FOR_EACH,
            _ => {
                incoming.insert(provider);
            }
        }
    }
}

impl Select {
    pub fn new(
        provides: EndpointProvidesPreProcessed,
        handlebars: &Arc<Handlebars>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Self {
        let mut providers = BTreeSet::new();
        let mut special_providers = 0;
        let join = provides
            .for_each
            .iter()
            .map(|s| {
                let pairs = Select::parse(Rule::entry_point, s).unwrap();
                let v =
                    parse_complex_expression(pairs, handlebars, &mut providers, static_providers);
                if providers.contains("for_each") {
                    panic!("cannot reference `for_each` from within `for_each`");
                }
                v.into()
            })
            .collect();
        let mut where_clause_special_providers = 0;
        let where_clause = provides.where_clause.as_ref().map(|s| {
            let mut providers2 = BTreeSet::new();
            let pairs = Select::parse(Rule::entry_point, s).unwrap();
            let ce = parse_complex_expression(pairs, handlebars, &mut providers2, static_providers);
            providers_helper(&mut providers2, &mut where_clause_special_providers);
            providers.extend(providers2);
            ce
        });
        special_providers |= where_clause_special_providers;
        let select = parse_select(
            provides.select,
            handlebars,
            &mut providers,
            static_providers,
        );
        providers_helper(&mut providers, &mut special_providers);
        Select {
            join,
            providers,
            special_providers,
            select,
            send_behavior: provides.send,
            where_clause,
            where_clause_special_providers,
        }
    }

    pub fn get_providers(&self) -> &BTreeSet<String> {
        &self.providers
    }

    pub fn get_special_providers(&self) -> u16 {
        self.special_providers
    }

    pub fn get_send_behavior(&self) -> EndpointProvidesSendOptions {
        self.send_behavior
    }

    pub fn get_where_clause_special_providers(&self) -> u16 {
        self.where_clause_special_providers
    }

    pub fn execute_where(&self, d: &json::Value) -> bool {
        self.where_clause
            .as_ref()
            .map(|wc| wc.execute(d))
            .unwrap_or(true)
    }

    pub fn as_iter(&self, mut d: json::Value) -> impl Iterator<Item = json::Value> + Clone {
        if self.join.is_empty() {
            if let Some(wc) = &self.where_clause {
                if wc.execute(&d) {
                    Either3::A(iter::once(self.select.evaluate(&d)))
                } else {
                    Either3::B(iter::empty())
                }
            } else {
                Either3::A(iter::once(self.select.evaluate(&d)))
            }
        } else {
            let references_for_each = self.special_providers & FOR_EACH != 0;
            let where_clause = self.where_clause.clone();
            let select = self.select.clone();
            Either3::C(
                self.join
                    .iter()
                    .map(|v| v.evaluate_as_iter(&d))
                    .multi_cartesian_product()
                    .filter_map(move |v| {
                        if references_for_each {
                            d = d.clone();
                            d.as_object_mut()
                                .unwrap()
                                .insert("for_each".to_string(), json::Value::Array(v));
                        }
                        if let Some(wc) = where_clause.clone() {
                            if wc.execute(&d) {
                                Some(select.evaluate(&d))
                            } else {
                                None
                            }
                        } else {
                            Some(select.evaluate(&d))
                        }
                    }),
            )
        }
    }
}

fn parse_select(
    select: json::Value,
    handlebars: &Arc<Handlebars>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> ParsedSelect {
    match select {
        json::Value::Null => ParsedSelect::Null,
        json::Value::Bool(b) => ParsedSelect::Bool(b),
        json::Value::Number(n) => ParsedSelect::Number(n),
        json::Value::String(s) => {
            let expression =
                ValueOrComplexExpression::new(&s, handlebars, providers, static_providers);
            ParsedSelect::Expression(expression)
        }
        json::Value::Array(a) => {
            let new = a
                .into_iter()
                .map(|v| parse_select(v, handlebars, providers, static_providers))
                .collect();
            ParsedSelect::Array(new)
        }
        json::Value::Object(m) => {
            let new = m
                .into_iter()
                .map(|(k, v)| (k, parse_select(v, handlebars, providers, static_providers)))
                .collect();
            ParsedSelect::Object(new)
        }
    }
}

fn parse_function_call(
    pair: Pair<Rule>,
    handlebars: &Arc<Handlebars>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> Either<FunctionCall, json::Value> {
    let mut ident = None;
    let mut args = Vec::new();
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::function_ident => {
                ident = Some(pair.as_str());
            }
            Rule::function_call => {
                match parse_function_call(pair, handlebars, providers, static_providers) {
                    Either::A(fc) => args.push(FunctionArg::FunctionCall(fc)),
                    Either::B(v) => args.push(FunctionArg::Value(Value::Json(false, v))),
                }
            }
            Rule::value => {
                args.push(FunctionArg::Value(parse_value(
                    pair.into_inner(),
                    handlebars,
                    providers,
                    static_providers,
                )));
            }
            r => unreachable!("unexpected rule for function call, `{:?}`", r),
        }
    }
    FunctionCall::new(ident.unwrap(), args, providers, static_providers)
}

fn parse_indexed_property(
    pair: Pair<Rule>,
    handlebars: &Arc<Handlebars>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> JsonPathSegment {
    let pair = pair.into_inner().next().unwrap();
    match pair.as_rule() {
        Rule::string => JsonPathSegment::from_string(
            pair.as_str().into(),
            handlebars.clone(),
            providers,
            static_providers,
        ),
        Rule::integer => JsonPathSegment::Number(pair.as_str().parse().unwrap()),
        r => unreachable!("unexpected rule for path segment, `{:?}`", r),
    }
}

fn parse_json_path(
    pair: Pair<Rule>,
    handlebars: &Arc<Handlebars>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> JsonPath {
    let mut start = None;
    let mut rest = Vec::new();
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::function_call => {
                if start.is_none() {
                    let jps =
                        match parse_function_call(pair, handlebars, providers, static_providers) {
                            Either::A(fc) => JsonPathStart::FunctionCall(fc),
                            Either::B(v) => JsonPathStart::Value(v),
                        };
                    start = Some(jps);
                } else {
                    unreachable!("encountered unexpected function call");
                }
            }
            Rule::json_ident => {
                let s: String = pair.as_str().into();
                if start.is_none() {
                    start = Some(JsonPathStart::JsonIdent(s));
                } else {
                    rest.push(JsonPathSegment::from_string(
                        s,
                        handlebars.clone(),
                        providers,
                        static_providers,
                    ));
                }
            }
            Rule::indexed_property => {
                if start.is_none() {
                    unreachable!("encountered unexpected indexed property");
                } else {
                    rest.push(parse_indexed_property(
                        pair,
                        handlebars,
                        providers,
                        static_providers,
                    ));
                }
            }
            r => unreachable!("unexpected rule for json path, `{:?}`", r),
        }
    }
    let start = start.unwrap();
    if let JsonPathStart::JsonIdent(start) = &start {
        match (start, rest.first()) {
            (start, Some(JsonPathSegment::String(next)))
                if &*start == "request" || &*start == "response" =>
            {
                providers.insert(format!("{}.{}", start, next))
            }
            _ => providers.insert(start.clone()),
        };
    }
    JsonPath { start, rest }
}

fn parse_value(
    pairs: Pairs<Rule>,
    handlebars: &Arc<Handlebars>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> Value {
    let mut not = false;
    for pair in pairs {
        match pair.as_rule() {
            Rule::not => {
                not = true;
            }
            Rule::boolean => {
                let b = match pair.as_str() {
                    "true" => true,
                    "false" => false,
                    s => unreachable!("unexpected boolean value, `{}`", s),
                };
                return Value::Json(not, b.into());
            }
            Rule::null => return Value::Json(not, json::Value::Null),
            Rule::json_path => {
                return Value::JsonPath(
                    not,
                    parse_json_path(pair, handlebars, providers, static_providers),
                );
            }
            Rule::string => {
                return Value::from_string(
                    pair.as_str().into(),
                    not,
                    handlebars.clone(),
                    providers,
                    static_providers,
                );
            }
            Rule::integer | Rule::decimal => {
                return Value::Json(
                    not,
                    json::Value::Number(std::str::FromStr::from_str(pair.as_str()).unwrap()),
                );
            }
            Rule::value => {
                return parse_value(pair.into_inner(), handlebars, providers, static_providers);
            }
            r => unreachable!("unexpected rule for value, `{:?}`", r),
        }
    }
    unreachable!("unexpectedly reached end of function in parse_value")
}

fn parse_simple_expression(
    pair: Pair<Rule>,
    handlebars: &Arc<Handlebars>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> SimpleExpression {
    let mut lhs = None;
    let mut operator = None;
    let mut rhs = None;
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::value => {
                let v = Some(parse_value(
                    pair.into_inner(),
                    handlebars,
                    providers,
                    static_providers,
                ));
                if lhs.is_none() {
                    lhs = v;
                } else {
                    rhs = v;
                }
            }
            Rule::operator => {
                let o = match pair.as_str() {
                    "==" => Operator::Eq,
                    "!=" => Operator::Ne,
                    ">=" => Operator::Gte,
                    "<=" => Operator::Lte,
                    ">" => Operator::Gt,
                    "<" => Operator::Lt,
                    o => unreachable!("unexpected operator, `{:?}`", o),
                };
                operator = Some(o);
            }
            r => unreachable!("unexpected rule for simple expression, `{:?}`", r),
        }
    }
    let rest = if let (Some(o), Some(r)) = (operator, rhs) {
        Some((o, r))
    } else {
        None
    };
    SimpleExpression {
        lhs: lhs.unwrap(),
        rest,
    }
}

fn parse_complex_expression(
    pairs: Pairs<Rule>,
    handlebars: &Arc<Handlebars>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> ComplexExpression {
    let mut ret = ComplexExpression {
        combiner: Combiner::And,
        pieces: Vec::new(),
    };
    let mut append_to_previous = false;
    for pair in pairs {
        let rule = pair.as_rule();
        match rule {
            Rule::simple_expression | Rule::group_expression => {
                let new = match rule {
                    Rule::simple_expression => Expression::Simple(parse_simple_expression(
                        pair,
                        handlebars,
                        providers,
                        static_providers,
                    )),
                    Rule::group_expression => Expression::Complex(parse_complex_expression(
                        pair.into_inner(),
                        handlebars,
                        providers,
                        static_providers,
                    )),
                    _ => unreachable!("impossible"),
                };
                if append_to_previous {
                    // when we're in an "||" and we need to append an "&&"
                    append_to_previous = false;
                    if let Some(c) = {
                        match ret.pieces.last_mut().unwrap() {
                            Expression::Complex(c) => {
                                if let Combiner::And = c.combiner {
                                    Some(c)
                                } else {
                                    None
                                }
                            }
                            _ => None,
                        }
                    } {
                        c.pieces.push(new);
                    } else {
                        let previous = ret.pieces.pop().unwrap();
                        let ce = ComplexExpression {
                            combiner: Combiner::And,
                            pieces: vec![previous, new],
                        };
                        ret.pieces.push(Expression::Complex(ce));
                    }
                } else {
                    ret.pieces.push(new);
                }
            }
            Rule::combiner => {
                let c = match pair.as_str() {
                    "&&" => Combiner::And,
                    "||" => Combiner::Or,
                    c => unreachable!("unexpected combiner, `{:?}`", c),
                };
                if c != ret.combiner {
                    if ret.pieces.len() < 2 {
                        ret.combiner = c;
                    } else if c == Combiner::And {
                        append_to_previous = true;
                    } else {
                        ret = ComplexExpression {
                            combiner: c,
                            pieces: vec![Expression::Complex(ret)],
                        }
                    }
                }
            }
            Rule::EOI => (),
            r => unreachable!("unexpected rule for complex expression, `{:?}`", r),
        }
    }
    ret
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers;
    use crate::template::join_helper;
    use futures::{
        future::{join_all, lazy},
        sync::oneshot,
    };
    use maplit::btreemap;
    use serde_json as json;
    use tokio::runtime::current_thread;

    fn check_results(select: json::Value, data: json::Value, expect: &[json::Value], i: usize) {
        let select = create_select(select);
        let result: Vec<_> = select.as_iter(data).collect();
        assert_eq!(result.as_slice(), expect, "index {}", i)
    }

    fn create_select(json: json::Value) -> Select {
        let mut handlebars = Handlebars::new();
        handlebars.register_helper("join", Box::new(join_helper));
        handlebars.set_strict_mode(true);
        let eppp = json::from_value(json).unwrap();
        Select::new(eppp, &handlebars.into(), &Default::default())
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
            (json::json!(r#"for_each[0]"#), None, vec![], FOR_EACH),
            (json::json!(r#"stats.rtt"#), None, vec![], STATS),
            (json::json!(r#"`{{join b.e "-"}}`"#), None, vec!["b"], 0),
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
            let s = if let Some(wc) = where_clause {
                create_select(json::json!({ "select": select, "where": wc }))
            } else {
                create_select(json::json!({ "select": select }))
            };
            let providers: Vec<_> = std::iter::FromIterator::from_iter(s.get_providers());
            let rr_providers = s.get_special_providers();
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
                json::json!(r#"json_path("c.*.d")"#),
                vec![json::json!([1, 2, 3])],
            ),
            (
                json::json!("repeat(5)"),
                vec![json::json!([null, null, null, null, null])],
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
            (
                json::json!(r#"`{{join b.e "-"}}`"#),
                vec![json::json!("5-6-7-8")],
            ),
            (
                json::json!({"z": 42, "dees": r#"json_path("c.*.d")"#}),
                vec![json::json!({"z": 42, "dees": [1, 2, 3]})],
            ),
            (json::json!("collect(a, 3)"), vec![json::json!(3)]),
            (
                json::json!("collect(b.e, 39)"),
                vec![json::json!([5, 6, 7, 8])],
            ),
        ];

        for (i, (select, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            let s = json::json!({ "select": select });
            check_results(s, data, &expect, i);
        }
    }

    #[test]
    fn voce_stream() {
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

        let (tx, rx) = oneshot::channel::<()>();
        let test_end = rx.shared();

        current_thread::run(lazy(move || {
            let providers = data
                .into_iter()
                .map(move |(k, v)| {
                    let p = match v {
                        json::Value::Array(v) => providers::literals(v, None, test_end.clone()),
                        _ => providers::literals(vec![v], None, test_end.clone()),
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
                (r#"`{{join b.e "-"}}`"#, json::json!("5-6-7-8")),
            ];

            let mut handlebars = Handlebars::new();
            handlebars.register_helper("join", Box::new(join_helper));
            let handlebars = handlebars.into();
            let mut required_providers = BTreeSet::new();
            let static_providers = BTreeMap::new();
            let mut futures = Vec::new();
            for (i, (expr, expect)) in tests.into_iter().enumerate() {
                let voce = ValueOrComplexExpression::new(
                    expr,
                    &handlebars,
                    &mut required_providers,
                    &static_providers,
                );
                let fut = voce
                    .into_stream(&providers)
                    .map(|(v, _)| v)
                    .into_future()
                    .map(move |(v, _)| {
                        assert_eq!(v.unwrap(), expect, "index {}", i);
                    });
                futures.push(fut);
            }
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
            (r#""""#, &empty),
            (r#""beep""#, &three),
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
            ("false || (true && false) && true", &empty),
            ("false || (true || false) && true", &three),
        ];

        for (i, (where_clause, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            let select = json::json!({
                "select": "three",
                "where": where_clause
            });
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

        // (select, for_each, expect)
        let check_table = vec![
            (
                json::json!("a"),
                vec!["repeat(5)"],
                vec![
                    json::json!(3),
                    json::json!(3),
                    json::json!(3),
                    json::json!(3),
                    json::json!(3),
                ],
            ),
            (
                json::json!("for_each[1]"),
                vec!["repeat(3)", "true || false"],
                vec![true.into(), true.into(), true.into()],
            ),
            (
                json::json!("for_each[0]"),
                vec![r#"json_path("c.*.d")"#],
                vec![json::json!(1), json::json!(2), json::json!(3)],
            ),
            (
                json::json!("for_each[0]"),
                vec!["c"],
                vec![
                    json::json!({ "d": 1 }),
                    json::json!({ "d": 2 }),
                    json::json!({ "d": 3 }),
                ],
            ),
            (
                json::json!("for_each[1]"),
                vec!["repeat(2)", r#"json_path("c.*.d")"#],
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

        for (i, (select, for_each, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            let select = json::json!({
                "select": select,
                "for_each": for_each
            });
            check_results(select, data, &expect, i);
        }
    }
}
