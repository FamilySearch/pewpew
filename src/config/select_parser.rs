use super::expression_functions::{Collect, Encode, Epoch, Join, JsonPath, Match, Pad, Repeat};
use super::{EndpointProvidesPreProcessed, EndpointProvidesSendOptions};

use crate::channel;
use crate::config;
use crate::providers;
use crate::util::{json_value_into_string, json_value_to_string, Either, Either3};

use futures::{future, stream, Future, IntoFuture, Stream};
use itertools::Itertools;
use pest::{
    iterators::{Pair, Pairs},
    Parser as PestParser,
};
use pest_derive::Parser;
use serde_json as json;

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    env, iter,
    sync::Arc,
};

pub type AutoReturn = (
    config::EndpointProvidesSendOptions,
    channel::Sender<json::Value>,
    Vec<json::Value>,
);

pub(super) enum DeclareError {
    ProviderEnded(String),
    UnknownProvider(String),
}

#[derive(Clone)]
pub(super) enum FunctionArg {
    FunctionCall(FunctionCall),
    Value(Value),
}

impl FunctionArg {
    pub(super) fn evaluate<'a, 'b: 'a>(&'b self, d: &'a json::Value) -> Cow<'a, json::Value> {
        match self {
            FunctionArg::FunctionCall(fc) => Cow::Owned(fc.evaluate(d)),
            FunctionArg::Value(v) => v.evaluate(d),
        }
    }

    pub(super) fn evaluate_as_future(
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

#[derive(Clone)]
pub(super) enum FunctionCall {
    Collect(Arc<Collect>),
    Encode(Arc<Encode>),
    Epoch(Epoch),
    Join(Arc<Join>),
    JsonPath(Arc<JsonPath>),
    Match(Arc<Match>),
    Pad(Arc<Pad>),
    Repeat(Arc<Repeat>),
}

impl FunctionCall {
    fn new(
        ident: &str,
        args: Vec<FunctionArg>,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Either<Self, json::Value> {
        match ident {
            "collect" => Either::A(FunctionCall::Collect(Collect::new(args).into())),
            "encode" => Encode::new(args).map_a(|a| FunctionCall::Encode(a.into())),
            "end_pad" => Pad::new(false, args).map_a(|a| FunctionCall::Pad(a.into())),
            "epoch" => Either::A(FunctionCall::Epoch(Epoch::new(args))),
            "join" => Join::new(args).map_a(|a| FunctionCall::Join(a.into())),
            "json_path" => JsonPath::new(args, providers, static_providers)
                .map_a(|a| FunctionCall::JsonPath(a.into())),
            "match" => Match::new(args)
                .unwrap()
                .map_a(|a| FunctionCall::Match(a.into())),
            "start_pad" => Pad::new(true, args).map_a(|a| FunctionCall::Pad(a.into())),
            "repeat" => Either::A(FunctionCall::Repeat(Repeat::new(args).into())),
            _ => panic!("unknown function reference `{}`", ident),
        }
    }
    fn evaluate(&self, d: &json::Value) -> json::Value {
        match self {
            FunctionCall::Collect(c) => c.evaluate(d),
            FunctionCall::Encode(e) => e.evaluate(d),
            FunctionCall::Epoch(e) => e.evaluate(),
            FunctionCall::Join(j) => j.evaluate(d),
            FunctionCall::JsonPath(j) => j.evaluate(d),
            FunctionCall::Match(m) => m.evaluate(d),
            FunctionCall::Pad(p) => p.evaluate(d),
            FunctionCall::Repeat(r) => r.evaluate(),
        }
    }

    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        match self {
            FunctionCall::Collect(c) => Either3::A(Either3::A(c.evaluate_as_iter(d))),
            FunctionCall::Encode(e) => Either3::A(Either3::B(e.evaluate_as_iter(d))),
            FunctionCall::Epoch(e) => Either3::A(Either3::C(e.evaluate_as_iter())),
            FunctionCall::Join(j) => Either3::B(Either::A(j.evaluate_as_iter(d))),
            FunctionCall::JsonPath(j) => Either3::B(Either::B(j.evaluate_as_iter(d))),
            FunctionCall::Match(m) => Either3::C(Either3::A(m.evaluate_as_iter(d))),
            FunctionCall::Pad(p) => Either3::C(Either3::B(p.evaluate_as_iter(d))),
            FunctionCall::Repeat(r) => Either3::C(Either3::C(r.evaluate_as_iter())),
        }
    }

    fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        match self {
            FunctionCall::Collect(c) => Either3::A(Either3::A(c.evaluate_as_future(providers))),
            FunctionCall::Encode(e) => Either3::A(Either3::B(e.evaluate_as_future(providers))),
            FunctionCall::Epoch(e) => Either3::A(Either3::C(e.evaluate_as_future())),
            FunctionCall::Join(j) => Either3::B(Either::A(j.clone().evaluate_as_future(providers))),
            FunctionCall::JsonPath(j) => {
                Either3::B(Either::B(j.clone().evaluate_as_future(providers)))
            }
            FunctionCall::Match(m) => {
                Either3::C(Either3::A(m.clone().evaluate_as_future(providers)))
            }
            FunctionCall::Pad(p) => Either3::C(Either3::B(p.clone().evaluate_as_future(providers))),
            FunctionCall::Repeat(r) => Either3::C(Either3::C(r.evaluate_as_future())),
        }
    }
}

fn index_json<'a>(
    json: &'a json::Value,
    index: Either<&PathSegment, &str>,
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

fn index_json2<'a>(mut json: &'a json::Value, indexes: &[PathSegment]) -> json::Value {
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
pub struct Path {
    pub(super) start: PathStart,
    pub(super) rest: Vec<PathSegment>,
}

impl Path {
    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        match &self.start {
            PathStart::FunctionCall(fnc) => {
                let rest = self.rest.clone();
                Either::A(fnc.evaluate_as_iter(d).map(move |j| index_json2(&j, &rest)))
            }
            PathStart::Ident(s) => {
                let j = index_json(d, Either::B(s));
                Either::B(iter::once(index_json2(&j, &self.rest)))
            }
            PathStart::Value(v) => Either::B(iter::once(v.clone())),
        }
    }

    fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        let rest = self.rest.clone();
        match self.start.clone() {
            PathStart::FunctionCall(fnc) => Either3::A(
                fnc.evaluate_as_future(providers)
                    .map(move |(j, returns)| (index_json2(&j, &rest), returns)),
            ),
            PathStart::Ident(s) => {
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
            PathStart::Value(v) => {
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
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Self {
        let pairs = Parser::parse(Rule::entry_point, expr).unwrap();
        let value = parse_complex_expression(pairs, providers, static_providers);
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

    fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        match self {
            ValueOrComplexExpression::V(v) => Either::A(v.evaluate_as_future(&providers)),
            ValueOrComplexExpression::Ce(ce) => Either::B(
                ce.execute_as_future(&providers)
                    .map(|(b, returns)| (b.into(), returns)),
            ),
        }
    }

    pub fn into_stream(
        self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = ()> {
        let providers = providers.clone();
        let this = Arc::new(self);
        stream::repeat(())
            .and_then(move |_| this.evaluate_as_future(&providers))
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
                let value = std::mem::replace(&mut se.lhs, Value::Json(json::Value::Null));
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
    Path(Not, Path),
    Json(json::Value),
    Template(Not, Arc<Template>),
}

impl Value {
    fn evaluate<'a, 'b: 'a>(&'b self, d: &'a json::Value) -> Cow<'a, json::Value> {
        let (not, v) = match self {
            Value::Path(not, path) => {
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
            Value::Json(value) => return Cow::Borrowed(value),
            Value::Template(not, t) => (*not, Cow::Owned(t.evaluate(d).into())),
        };
        if not {
            Cow::Owned(json::Value::Bool(!bool_value(&*v)))
        } else {
            v
        }
    }

    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        match self {
            Value::Path(not, path) => {
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
    ) -> Box<dyn Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> + Sync + Send>
    {
        let (not, f) = match self {
            Value::Path(not, path) => {
                let f = Either3::A(path.evaluate_as_future(providers));
                (*not, f)
            }
            Value::Json(value) => (false, Either3::B(future::ok((value.clone(), Vec::new())))),
            Value::Template(not, t) => {
                let f = t
                    .evaluate_as_future(providers)
                    .map(|(s, v)| (json::Value::String(s), v));
                (*not, Either3::C(f))
            }
        };
        let f = f.map(move |(v, returns)| {
            let v = if not {
                json::Value::Bool(!bool_value(&v))
            } else {
                v
            };
            (v, returns)
        });
        Box::new(f)
    }
}

#[derive(Clone)]
pub(super) enum PathSegment {
    Number(usize),
    String(String),
    Template(Arc<Template>),
}

impl PathSegment {
    fn from_str(
        s: &str,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Self {
        let template = Template::new(s, static_providers);
        match template.simplify_to_string() {
            Either::A(s) => PathSegment::String(s),
            Either::B(t) => {
                providers.extend(t.get_providers().clone());
                PathSegment::Template(t.into())
            }
        }
    }

    fn evaluate(&self, d: &json::Value) -> Either<String, usize> {
        match self {
            PathSegment::Number(n) => Either::B(*n),
            PathSegment::String(s) => Either::A(s.clone()),
            PathSegment::Template(t) => Either::A(t.evaluate(d)),
        }
    }
}

#[derive(Clone)]
pub(super) enum PathStart {
    FunctionCall(FunctionCall),
    Ident(String),
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
    fn simplify_to_string(mut self) -> Either<String, Self> {
        match self.pieces.as_slice() {
            [Expression::Complex(_)] => {
                let c = self.pieces.pop().unwrap();
                if let Expression::Complex(c) = c {
                    c.simplify_to_string()
                } else {
                    unreachable!()
                }
            }
            [Expression::Simple(SimpleExpression {
                lhs: Value::Json(j),
                rest: None,
            })] => Either::A(json_value_to_string(j).into_owned()),
            _ => Either::B(self),
        }
    }

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

#[grammar = "config/select.pest"]
#[derive(Parser)]
struct Parser;

#[derive(Clone)]
enum TemplatePiece {
    Expression(ValueOrComplexExpression),
    NotExpression(String),
}

#[derive(Clone)]
pub struct Template {
    pieces: Vec<TemplatePiece>,
    providers: BTreeSet<String>,
    size_hint: usize,
}

impl Template {
    pub fn new(t: &str, static_providers: &BTreeMap<String, json::Value>) -> Self {
        let pairs = Parser::parse(Rule::template_entry_point, t)
            .unwrap()
            .nth(0)
            .unwrap()
            .into_inner();
        let mut pieces = Vec::new();
        let mut providers = BTreeSet::new();
        let mut size_hint = 0;
        for pair in pairs {
            let piece = match pair.as_rule() {
                Rule::template_expression => {
                    let ce = parse_complex_expression(
                        pair.into_inner(),
                        &mut providers,
                        static_providers,
                    );
                    match ce.simplify_to_string() {
                        Either::A(s2) => {
                            if let Some(TemplatePiece::NotExpression(s)) = pieces.last_mut() {
                                s.push_str(&s2);
                                continue;
                            } else {
                                TemplatePiece::NotExpression(s2)
                            }
                        }
                        Either::B(b) => TemplatePiece::Expression(b.into()),
                    }
                }
                Rule::template_not_expression => {
                    let s = pair.as_str();
                    size_hint += s.len();
                    TemplatePiece::NotExpression(pair.as_str().into())
                }
                _ => unreachable!(),
            };
            pieces.push(piece);
        }
        Template {
            pieces,
            providers,
            size_hint,
        }
    }

    pub fn simplify_to_string(mut self) -> Either<String, Self> {
        match self.pieces.as_slice() {
            [TemplatePiece::NotExpression(_)] => {
                if let TemplatePiece::NotExpression(s) = self.pieces.pop().unwrap() {
                    Either::A(s)
                } else {
                    unreachable!()
                }
            }
            _ => Either::B(self),
        }
    }

    pub fn get_providers(&self) -> &BTreeSet<String> {
        &self.providers
    }

    pub fn evaluate(&self, d: &json::Value) -> String {
        self.pieces
            .iter()
            .map(|piece| match piece {
                TemplatePiece::Expression(voce) => {
                    let v = voce.evaluate(d);
                    json_value_to_string(&*v).into_owned()
                }
                TemplatePiece::NotExpression(s) => s.clone(),
            })
            .join("")
    }

    fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (String, Vec<AutoReturn>), Error = DeclareError> {
        let futures = self.pieces.iter().map(|piece| match piece {
            TemplatePiece::Expression(voce) => {
                let a = voce
                    .evaluate_as_future(providers)
                    .map(|v| (json_value_into_string(v.0), v.1));
                Either::A(a)
            }
            TemplatePiece::NotExpression(s) => {
                let b = future::ok((s.clone(), Vec::new()));
                Either::B(b)
            }
        });
        stream::futures_ordered(futures).fold(
            (String::with_capacity(self.size_hint), Vec::new()),
            |(mut s, mut returns), (s2, returns2)| {
                s.push_str(&s2);
                returns.extend(returns2);
                Ok((s, returns))
            },
        )
    }
}

#[derive(Clone)]
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
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Self {
        let mut providers = BTreeSet::new();
        let mut special_providers = 0;
        let join = provides
            .for_each
            .iter()
            .map(|s| {
                let pairs = Parser::parse(Rule::entry_point, s).unwrap();
                let v = parse_complex_expression(pairs, &mut providers, static_providers);
                if providers.contains("for_each") {
                    panic!("cannot reference `for_each` from within `for_each`");
                }
                v.into()
            })
            .collect();
        let mut where_clause_special_providers = 0;
        let where_clause = provides.where_clause.as_ref().map(|s| {
            let mut providers2 = BTreeSet::new();
            let pairs = Parser::parse(Rule::entry_point, s).unwrap();
            let ce = parse_complex_expression(pairs, &mut providers2, static_providers);
            providers_helper(&mut providers2, &mut where_clause_special_providers);
            providers.extend(providers2);
            ce
        });
        special_providers |= where_clause_special_providers;
        let select = parse_select(provides.select, &mut providers, static_providers);
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
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> ParsedSelect {
    match select {
        json::Value::Null => ParsedSelect::Null,
        json::Value::Bool(b) => ParsedSelect::Bool(b),
        json::Value::Number(n) => ParsedSelect::Number(n),
        json::Value::String(s) => {
            let expression = ValueOrComplexExpression::new(&s, providers, static_providers);
            ParsedSelect::Expression(expression)
        }
        json::Value::Array(a) => {
            let new = a
                .into_iter()
                .map(|v| parse_select(v, providers, static_providers))
                .collect();
            ParsedSelect::Array(new)
        }
        json::Value::Object(m) => {
            let new = m
                .into_iter()
                .map(|(k, v)| (k, parse_select(v, providers, static_providers)))
                .collect();
            ParsedSelect::Object(new)
        }
    }
}

fn parse_function_call(
    pair: Pair<Rule>,
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
            Rule::function_call => match parse_function_call(pair, providers, static_providers) {
                Either::A(fc) => args.push(FunctionArg::FunctionCall(fc)),
                Either::B(v) => args.push(FunctionArg::Value(Value::Json(v))),
            },
            Rule::value => {
                args.push(FunctionArg::Value(parse_value(
                    pair.into_inner(),
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
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> PathSegment {
    let pair = pair.into_inner().next().unwrap();
    match pair.as_rule() {
        Rule::string => PathSegment::from_str(pair.as_str(), providers, static_providers),
        Rule::integer => PathSegment::Number(pair.as_str().parse().unwrap()),
        r => unreachable!("unexpected rule for path segment, `{:?}`", r),
    }
}

fn parse_json_path(
    pair: Pair<Rule>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> Path {
    let mut start = None;
    let mut rest = Vec::new();
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::function_call => {
                if start.is_none() {
                    let jps = match parse_function_call(pair, providers, static_providers) {
                        Either::A(fc) => PathStart::FunctionCall(fc),
                        Either::B(v) => PathStart::Value(v),
                    };
                    start = Some(jps);
                } else {
                    unreachable!("encountered unexpected function call");
                }
            }
            Rule::json_ident => {
                let s = pair.as_str();
                if start.is_none() {
                    start = match (
                        s.starts_with('$'),
                        env::var(&s[1..]),
                        static_providers.get(s),
                    ) {
                        (true, Ok(s), _) => {
                            let v = json::from_str(&s).unwrap_or_else(|_e| json::Value::String(s));
                            Some(PathStart::Value(v))
                        }
                        (_, _, Some(v)) => Some(PathStart::Value(v.clone())),
                        _ => Some(PathStart::Ident(s.into())),
                    };
                } else {
                    let ps = PathSegment::from_str(pair.as_str(), providers, static_providers);
                    rest.push(ps);
                }
            }
            Rule::indexed_property => {
                if start.is_none() {
                    unreachable!("encountered unexpected indexed property");
                } else {
                    rest.push(parse_indexed_property(pair, providers, static_providers));
                }
            }
            r => unreachable!("unexpected rule for json path, `{:?}`", r),
        }
    }
    let start = start.unwrap();
    if let PathStart::Ident(s) = &start {
        static_providers.get(s);
        match rest.first() {
            Some(PathSegment::String(next)) if &*s == "request" || &*s == "response" => {
                providers.insert(format!("{}.{}", s, next));
            }
            _ => {
                providers.insert(s.clone());
            }
        };
    }
    Path { start, rest }
}

fn parse_value(
    pairs: Pairs<Rule>,
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
                let mut b = match pair.as_str() {
                    "true" => true,
                    "false" => false,
                    s => unreachable!("unexpected boolean value, `{}`", s),
                };
                if not {
                    b = !b;
                }
                return Value::Json(b.into());
            }
            Rule::null => {
                if not {
                    return Value::Json(true.into());
                } else {
                    return Value::Json(json::Value::Null);
                }
            }
            Rule::json_path => {
                return Value::Path(not, parse_json_path(pair, providers, static_providers));
            }
            Rule::string => {
                let template = Template::new(pair.as_str(), static_providers);
                match template.simplify_to_string() {
                    Either::A(s) => {
                        if not {
                            let b = !s.is_empty();
                            return Value::Json(b.into());
                        } else {
                            return Value::Json(s.into());
                        }
                    }
                    Either::B(t) => {
                        providers.extend(t.get_providers().clone());
                        return Value::Template(not, t.into());
                    }
                }
            }
            Rule::integer | Rule::decimal => {
                let j = json::Value::Number(std::str::FromStr::from_str(pair.as_str()).unwrap());
                if not {
                    let b = !bool_value(&j);
                    return Value::Json(b.into());
                } else {
                    return Value::Json(j);
                }
            }
            Rule::value => {
                return parse_value(pair.into_inner(), providers, static_providers);
            }
            r => unreachable!("unexpected rule for value, `{:?}`", r),
        }
    }
    unreachable!("unexpectedly reached end of function in parse_value")
}

fn parse_simple_expression(
    pair: Pair<Rule>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> SimpleExpression {
    let mut lhs = None;
    let mut operator = None;
    let mut rhs = None;
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::value => {
                let v = Some(parse_value(pair.into_inner(), providers, static_providers));
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
                        providers,
                        static_providers,
                    )),
                    Rule::group_expression => Expression::Complex(parse_complex_expression(
                        pair.into_inner(),
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
        println!("{:?}", json);
        let eppp = json::from_value(json).unwrap();
        Select::new(eppp, &Default::default())
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

        env::set_var("ZED", "26");

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
            (json::json!("$ZED"), vec![json::json!(26)]),
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
                ("join(b.e, '-')", json::json!("5-6-7-8")),
            ];

            let mut required_providers = BTreeSet::new();
            let static_providers = BTreeMap::new();
            let mut futures = Vec::new();
            for (i, (expr, expect)) in tests.into_iter().enumerate() {
                let voce =
                    ValueOrComplexExpression::new(expr, &mut required_providers, &static_providers);
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
