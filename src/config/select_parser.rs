use super::expression_functions::{
    Collect, Encode, Epoch, If, Join, JsonPath, Match, MinMax, Pad, Random, Range, Repeat,
};
use super::{EndpointProvidesPreProcessed, EndpointProvidesSendOptions};

use crate::config;
use crate::error::{RecoverableError, TestError};
use crate::providers;
use crate::util::{json_value_into_string, json_value_to_string};

use ether::{Either, Either3};
use futures::{stream, Async, Future, IntoFuture, Sink, Stream};
use itertools::Itertools;
use pest::{
    iterators::{Pair, Pairs},
    Parser as PestParser,
};
use pest_derive::Parser;
use serde_json as json;
use zip_all::zip_all;

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    env, iter,
    sync::Arc,
};

#[derive(Clone)]
pub struct AutoReturn {
    send_option: config::EndpointProvidesSendOptions,
    channel: channel::Sender<json::Value>,
    jsons: Vec<json::Value>,
}

impl AutoReturn {
    pub fn new(
        send_option: config::EndpointProvidesSendOptions,
        channel: channel::Sender<json::Value>,
        jsons: Vec<json::Value>,
    ) -> Self {
        AutoReturn {
            send_option,
            channel,
            jsons,
        }
    }

    pub fn into_future(self) -> AutoReturnFuture {
        AutoReturnFuture::new(self)
    }
}

existential type ARInner: Future<Item = (), Error = ()>;

pub struct AutoReturnFuture {
    inner: Either<ARInner, (bool, channel::Sender<json::Value>, Vec<json::Value>)>,
}

impl AutoReturnFuture {
    fn new(ar: AutoReturn) -> Self {
        let channel = ar.channel;
        let jsons = ar.jsons;
        let inner = match ar.send_option {
            EndpointProvidesSendOptions::Block => {
                let a: ARInner = channel.send_all(stream::iter_ok(jsons)).then(|_| Ok(()));
                Either::A(a)
            }
            EndpointProvidesSendOptions::Force => Either::B((true, channel, jsons)),
            EndpointProvidesSendOptions::IfNotFull => Either::B((false, channel, jsons)),
        };
        AutoReturnFuture { inner }
    }
}

impl Future for AutoReturnFuture {
    type Item = ();
    type Error = ();

    fn poll(&mut self) -> Result<Async<()>, ()> {
        match &mut self.inner {
            Either::A(ref mut a) => a.poll(),
            Either::B((true, ref channel, ref mut jsons)) => {
                while let Some(json) = jsons.pop() {
                    channel.force_send(json);
                }
                Ok(Async::Ready(()))
            }
            Either::B((false, ref channel, ref mut jsons)) => {
                while let Some(json) = jsons.pop() {
                    if !channel.try_send(json).is_success() {
                        break;
                    }
                }
                Ok(Async::Ready(()))
            }
        }
    }
}

#[derive(Clone, Debug)]
pub(super) enum FunctionCall {
    Collect(Collect),
    Encode(Encode),
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
}

impl FunctionCall {
    fn new(
        ident: &str,
        args: Vec<ValueOrExpression>,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Result<Either<Self, json::Value>, TestError> {
        let r = match ident {
            "collect" => Either::A(FunctionCall::Collect(Collect::new(args)?)),
            "encode" => Encode::new(args)?.map_a(FunctionCall::Encode),
            "end_pad" => Pad::new(false, args)?.map_a(FunctionCall::Pad),
            "epoch" => Either::A(FunctionCall::Epoch(Epoch::new(args)?)),
            "if" => If::new(args)?.map_a(|a| FunctionCall::If(a.into())),
            "join" => Join::new(args)?.map_a(FunctionCall::Join),
            "json_path" => {
                JsonPath::new(args, providers, static_providers)?.map_a(FunctionCall::JsonPath)
            }
            "match" => Match::new(args)?.map_a(FunctionCall::Match),
            "max" => MinMax::new(false, args)?.map_a(FunctionCall::MinMax),
            "min" => MinMax::new(true, args)?.map_a(FunctionCall::MinMax),
            "start_pad" => Pad::new(true, args)?.map_a(FunctionCall::Pad),
            "random" => Either::A(FunctionCall::Random(Random::new(args)?)),
            "range" => Either::A(FunctionCall::Range(Range::new(args)?.into())),
            "repeat" => Either::A(FunctionCall::Repeat(Repeat::new(args)?)),
            _ => return Err(TestError::InvalidFunction(ident.into())),
        };
        Ok(r)
    }
    fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        match self {
            FunctionCall::Collect(c) => c.evaluate(d),
            FunctionCall::Encode(e) => e.evaluate(d),
            FunctionCall::Epoch(e) => e.evaluate(),
            FunctionCall::If(i) => i.evaluate(d),
            FunctionCall::Join(j) => j.evaluate(d),
            FunctionCall::JsonPath(j) => Ok(j.evaluate(d)),
            FunctionCall::Match(m) => m.evaluate(d),
            FunctionCall::MinMax(m) => m.evaluate(d),
            FunctionCall::Pad(p) => p.evaluate(d),
            FunctionCall::Range(r) => r.evaluate(d),
            FunctionCall::Random(r) => Ok(r.evaluate()),
            FunctionCall::Repeat(r) => Ok(r.evaluate()),
        }
    }

    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        let r = match self {
            FunctionCall::Collect(c) => Either3::A(Either3::A(c.evaluate_as_iter(d)?)),
            FunctionCall::Encode(e) => Either3::A(Either3::B(e.evaluate_as_iter(d)?)),
            FunctionCall::Epoch(e) => Either3::A(Either3::C(Either::A(e.evaluate_as_iter()?))),
            FunctionCall::If(i) => Either3::A(Either3::C(Either::B(i.evaluate_as_iter(d)?))),
            FunctionCall::Join(j) => Either3::B(Either3::A(j.evaluate_as_iter(d)?)),
            FunctionCall::JsonPath(j) => Either3::B(Either3::B(j.evaluate_as_iter(d))),
            FunctionCall::Match(m) => Either3::B(Either3::C(m.evaluate_as_iter(d)?)),
            FunctionCall::MinMax(m) => Either3::C(Either3::A(Either3::A(m.evaluate_as_iter(d)?))),
            FunctionCall::Pad(p) => Either3::C(Either3::A(Either3::B(p.evaluate_as_iter(d)?))),
            FunctionCall::Random(r) => Either3::C(Either3::A(Either3::C(r.evaluate_as_iter()))),
            FunctionCall::Range(r) => Either3::C(Either3::B(r.evaluate_as_iter(d)?)),
            FunctionCall::Repeat(r) => Either3::C(Either3::C(r.evaluate_as_iter())),
        };
        Ok(r)
    }

    fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> Box<dyn Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> + Sync + Send>
    {
        let f = match self {
            FunctionCall::Collect(c) => Either3::A(Either3::A(c.into_stream(providers))),
            FunctionCall::Encode(e) => Either3::A(Either3::B(e.into_stream(providers))),
            FunctionCall::Epoch(e) => Either3::A(Either3::C(Either::A(e.into_stream()))),
            FunctionCall::If(i) => Either3::A(Either3::C(Either::B(i.into_stream(providers)))),
            FunctionCall::Join(j) => Either3::B(Either3::A(j.into_stream(providers))),
            FunctionCall::JsonPath(j) => Either3::B(Either3::B(j.into_stream(providers))),
            FunctionCall::Match(m) => Either3::B(Either3::C(m.into_stream(providers))),
            FunctionCall::MinMax(m) => Either3::C(Either3::A(Either3::A(m.into_stream(providers)))),
            FunctionCall::Pad(p) => Either3::C(Either3::A(Either3::B(p.into_stream(providers)))),
            FunctionCall::Random(r) => Either3::C(Either3::A(Either3::C(r.into_stream()))),
            FunctionCall::Range(r) => Either3::C(Either3::B(r.into_stream(providers))),
            FunctionCall::Repeat(r) => Either3::C(Either3::C(r.into_stream())),
        };
        // boxed to prevent recursive impl Stream
        Box::new(f)
    }
}

fn index_json<'a>(
    json: &'a json::Value,
    index: Either<&PathSegment, &str>,
) -> Result<Cow<'a, json::Value>, TestError> {
    #[allow(unused_assignments)]
    let mut holder = None;
    let str_or_number = match index {
        Either::A(jps) => match jps.evaluate(json)? {
            Either::A(s) => {
                holder = Some(s);
                Either::A(holder.as_ref().expect("should have a value").as_str())
            }
            Either::B(n) => Either::B(n),
        },
        Either::B(s) => Either::A(s),
    };
    let o = match (json, str_or_number) {
        (json::Value::Object(m), Either::A(s)) => m.get(s),
        (json::Value::Array(a), Either::B(n)) => a.get(n),
        (json::Value::Array(a), Either::A(s)) if s == "length" => {
            return Ok(Cow::Owned((a.len() as u64).into()));
        }
        (_, Either::A(s)) => {
            return Err(RecoverableError::IndexingJson(s.into(), json.clone()).into());
        }
        (_, Either::B(n)) => {
            return Err(RecoverableError::IndexingJson(format!("[{}]", n), json.clone()).into());
        }
    };
    Ok(Cow::Borrowed(o.unwrap_or(&json::Value::Null)))
}

fn index_json2<'a>(
    mut json: &'a json::Value,
    indexes: &[PathSegment],
) -> Result<json::Value, TestError> {
    for (i, index) in indexes.iter().enumerate() {
        let o = match (json, index.evaluate(json)?) {
            (json::Value::Object(m), Either::A(ref s)) => m.get(s),
            (json::Value::Array(a), Either::B(n)) => a.get(n),
            (json::Value::Array(a), Either::A(ref s)) if s == "length" => {
                let ret = (a.len() as u64).into();
                if i != indexes.len() - 1 {
                    return Err(RecoverableError::IndexingJson(s.clone(), ret).into());
                }
                return Ok(ret);
            }
            (_, Either::A(s)) => return Err(RecoverableError::IndexingJson(s, json.clone()).into()),
            (_, Either::B(n)) => {
                return Err(RecoverableError::IndexingJson(format!("[{}]", n), json.clone()).into());
            }
        };
        json = o.unwrap_or(&json::Value::Null)
    }
    Ok(json.clone())
}

#[derive(Clone, Debug)]
pub struct Path {
    pub(super) start: PathStart,
    pub(super) rest: Vec<PathSegment>,
}

impl Path {
    fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        let v = match &self.start {
            PathStart::FunctionCall(f) => Cow::Owned(f.evaluate(d)?),
            PathStart::Ident(s) => index_json(d, Either::B(s))?,
            PathStart::Value(v) => Cow::Borrowed(v),
        };
        index_json2(&*v, &self.rest)
    }

    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> Result<impl Iterator<Item = Result<json::Value, TestError>> + Clone, TestError> {
        let r = match &self.start {
            PathStart::FunctionCall(fnc) => {
                let rest = self.rest.clone();
                Either::A(
                    fnc.evaluate_as_iter(d)?
                        .map(move |j| index_json2(&j, &rest)),
                )
            }
            PathStart::Ident(s) => {
                let j = index_json(d, Either::B(s))?;
                Either::B(iter::once(Ok(index_json2(&*j, &self.rest)?)))
            }
            PathStart::Value(v) => Either::B(iter::once(Ok(v.clone()))),
        };
        Ok(r)
    }

    fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        // TODO: don't we need providers when evaluating `rest`?
        let rest = self.rest;
        match self.start {
            PathStart::FunctionCall(fnc) => {
                let a = fnc
                    .into_stream(providers)
                    .and_then(move |(j, returns)| Ok((index_json2(&j, &rest)?, returns)));
                Either3::A(a)
            }
            PathStart::Ident(s) => {
                let s = Arc::new(s);
                let s2 = s.clone();
                let b = providers
                    .get(&*s2)
                    .map(move |provider| {
                        let auto_return = provider.auto_return.map(|ar| (ar, provider.tx.clone()));
                        provider
                            .rx
                            .clone()
                            .map_err(move |_| {
                                TestError::Internal("unexpected error from provider".into())
                            })
                            .and_then(move |v| {
                                let mut outgoing = Vec::new();
                                if let Some((ar, tx)) = &auto_return {
                                    outgoing.push(AutoReturn::new(
                                        *ar,
                                        tx.clone(),
                                        vec![v.clone()],
                                    ));
                                }
                                let v = index_json2(&v, &rest)?;
                                Ok((v, outgoing))
                            })
                    })
                    .ok_or_else(move || TestError::UnknownProvider((&*s).clone()))
                    .into_future()
                    .flatten_stream();
                Either3::B(b)
            }
            PathStart::Value(v) => {
                let v = index_json2(&v, &rest).map(|v| (v, Vec::new()));
                Either3::C(stream::iter_result(iter::repeat(v)))
            }
        }
    }
}

pub(super) fn bool_value(json: &json::Value) -> Result<bool, TestError> {
    let r = match json {
        json::Value::Null => false,
        json::Value::Bool(b) => *b,
        json::Value::Number(n) if n.is_i64() => n.as_i64().expect("should be i64") != 0,
        json::Value::Number(n) if n.is_u64() => n.as_u64().expect("should be u64") != 0,
        json::Value::Number(n) if n.is_f64() => n.as_f64().expect("should be f64") != 0f64,
        json::Value::Number(_) => {
            return Err(TestError::Internal(
                "Number should always be i64, u64 or f64".into(),
            ));
        }
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
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Result<Self, TestError> {
        let pairs = Parser::parse(Rule::entry_point, expr)?;
        let e = parse_expression(pairs, providers, static_providers)?;
        ValueOrExpression::from_expression(e)
    }

    fn from_expression(e: Expression) -> Result<Self, TestError> {
        let voe = match e.simplify_to_json()? {
            Either::A(v) => ValueOrExpression::Value(Value::Json(v)),
            Either::B(e) => ValueOrExpression::Expression(e),
        };
        Ok(voe)
    }

    pub(super) fn evaluate<'a, 'b: 'a>(
        &'b self,
        d: &'a json::Value,
    ) -> Result<Cow<'a, json::Value>, TestError> {
        match self {
            ValueOrExpression::Value(v) => v.evaluate(d),
            ValueOrExpression::Expression(e) => e.evaluate(d),
        }
    }

    pub(super) fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> Result<impl Iterator<Item = Result<json::Value, TestError>> + Clone, TestError> {
        match self {
            ValueOrExpression::Value(v) => Ok(Either::A(v.evaluate_as_iter(d)?)),
            ValueOrExpression::Expression(e) => Ok(Either::B(e.evaluate_as_iter(d)?)),
        }
    }

    pub fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        match self {
            ValueOrExpression::Value(v) => Either::A(v.into_stream(providers)),
            ValueOrExpression::Expression(ce) => Either::B(ce.into_stream(providers)),
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
        d: &'a json::Value,
    ) -> Result<Cow<'a, json::Value>, TestError> {
        let v = match self {
            Value::Path(path) => {
                let mut v: Vec<_> = path.evaluate_as_iter(d)?.collect::<Result<_, _>>()?;
                if v.is_empty() {
                    return Err(TestError::Internal(
                        "evaluating path should never return no elements".into(),
                    ));
                } else if v.len() == 1 {
                    Cow::Owned(v.pop().expect("should have 1 element"))
                } else {
                    Cow::Owned(json::Value::Array(v))
                }
            }
            Value::Json(value) => Cow::Borrowed(value),
            Value::Template(t) => Cow::Owned(t.evaluate(d)?.into()),
        };
        Ok(v)
    }

    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> Result<impl Iterator<Item = Result<json::Value, TestError>> + Clone, TestError> {
        let r = match self {
            Value::Path(path) => Either3::B(
                path.evaluate_as_iter(d)?
                    .map(|v| match v {
                        Ok(json::Value::Array(v)) => Either::A(v.into_iter().map(Ok)),
                        _ => Either::B(iter::once(v)),
                    })
                    .flatten(),
            ),
            _ => {
                let value = self.evaluate(d)?.into_owned();
                match value {
                    json::Value::Array(v) => Either3::C(v.into_iter().map(Ok)),
                    _ => Either3::A(iter::once(Ok(value))),
                }
            }
        };
        Ok(r)
    }

    fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> Box<dyn Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> + Sync + Send>
    {
        let s = match self {
            Value::Path(path) => Either3::A(path.into_stream(providers)),
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
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Result<Self, TestError> {
        let template = Template::new(s, static_providers)?;
        let r = match template.simplify_to_string() {
            Either::A(s) => PathSegment::String(s),
            Either::B(t) => {
                providers.extend(t.get_providers().clone());
                PathSegment::Template(t.into())
            }
        };
        Ok(r)
    }

    fn evaluate(&self, d: &json::Value) -> Result<Either<String, usize>, TestError> {
        let r = match self {
            PathSegment::Number(n) => Either::B(*n),
            PathSegment::String(s) => Either::A(s.clone()),
            PathSegment::Template(t) => Either::A(t.evaluate(d)?),
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
        right: Result<Cow<'a, json::Value>, TestError>,
    ) -> Result<json::Value, TestError> {
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
        d: &'a json::Value,
    ) -> Result<Cow<'a, json::Value>, TestError> {
        let mut v = match &self.lhs {
            ExpressionLhs::Expression(e) => e.evaluate(d)?,
            ExpressionLhs::Value(v) => v.evaluate(d)?,
        };
        if let Some((op, rhs)) = &self.op {
            let rhs = rhs.evaluate(d);
            v = Cow::Owned(op.evaluate(&*v, rhs)?);
        }
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

    fn evaluate_as_iter<'a>(
        &self,
        d: &'a json::Value,
    ) -> Result<impl Iterator<Item = Result<json::Value, TestError>> + Clone, TestError> {
        let i = if let (None, None, ExpressionLhs::Value(v)) = (&self.op, &self.not, &self.lhs) {
            Either3::A(v.evaluate_as_iter(d)?)
        } else {
            let value = self.evaluate(d)?.into_owned();
            match value {
                json::Value::Array(v) => Either3::B(v.into_iter().map(Ok)),
                _ => Either3::C(iter::once(Ok(value))),
            }
        };
        Ok(Box::new(i))
    }

    fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> Box<dyn Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> + Send + Sync>
    {
        let v = match self.lhs {
            ExpressionLhs::Expression(e) => Either::A(e.into_stream(providers)),
            ExpressionLhs::Value(v) => Either::B(v.into_stream(providers)),
        };
        let not = self.not;
        let v = if let Some((op, rhs)) = self.op {
            let a = v.zip(rhs.into_stream(providers)).and_then(
                move |((lhs, mut returns), (r, returns2))| {
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
                },
            );
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

    fn simplify_to_json(self) -> Result<Either<json::Value, Self>, TestError> {
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

    fn simplify_to_string(self) -> Result<Either<String, Self>, TestError> {
        Ok(self.simplify_to_json()?.map_a(json_value_into_string))
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
    fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        let r = match self {
            ParsedSelect::Null => json::Value::Null,
            ParsedSelect::Bool(b) => json::Value::Bool(*b),
            ParsedSelect::Number(n) => json::Value::Number(n.clone()),
            ParsedSelect::Expression(v) => v.evaluate(d)?.into_owned(),
            ParsedSelect::Array(v) => {
                let v = v.iter().map(|p| p.evaluate(d)).collect::<Result<_, _>>()?;
                json::Value::Array(v)
            }
            ParsedSelect::Object(v) => {
                let m = v
                    .iter()
                    .map(|(k, v)| Ok::<_, TestError>((k.clone(), v.evaluate(d)?)))
                    .collect::<Result<_, _>>()?;
                json::Value::Object(m)
            }
        };
        Ok(r)
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

#[derive(Clone, Debug)]
enum TemplatePiece {
    Expression(ValueOrExpression),
    NotExpression(String),
}

#[derive(Clone, Debug)]
pub struct Template {
    pieces: Vec<TemplatePiece>,
    providers: BTreeSet<String>,
    size_hint: usize,
}

impl Template {
    pub fn new(
        t: &str,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Result<Self, TestError> {
        let pairs = Parser::parse(Rule::template_entry_point, t)?
            .nth(0)
            .ok_or_else(|| TestError::Internal("Expected 1 pair from parser".into()))?
            .into_inner();
        let mut pieces = Vec::new();
        let mut providers = BTreeSet::new();
        let mut size_hint = 0;
        for pair in pairs {
            let piece = match pair.as_rule() {
                Rule::template_expression => {
                    let e = parse_expression(pair.into_inner(), &mut providers, static_providers)?;
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
                    return Err(TestError::Internal(
                        format!("unexpected rule while parsing template, {:?}", rule).into(),
                    ));
                }
            };
            pieces.push(piece);
        }
        Ok(Template {
            pieces,
            providers,
            size_hint,
        })
    }

    pub fn simplify_to_string(mut self) -> Either<String, Self> {
        match self.pieces.as_slice() {
            [TemplatePiece::NotExpression(_)] => {
                if let Some(TemplatePiece::NotExpression(s)) = self.pieces.pop() {
                    Either::A(s)
                } else {
                    unreachable!("should not have seen anything other than a not expression")
                }
            }
            _ => Either::B(self),
        }
    }

    pub fn get_providers(&self) -> &BTreeSet<String> {
        &self.providers
    }

    pub fn evaluate(&self, d: &json::Value) -> Result<String, TestError> {
        self.pieces
            .iter()
            .map(|piece| match piece {
                TemplatePiece::Expression(voe) => {
                    let v = voe.evaluate(d)?;
                    Ok(json_value_to_string(&*v).into_owned())
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

    fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (String, Vec<AutoReturn>), Error = TestError> {
        let streams = self.pieces.into_iter().map(|piece| match piece {
            TemplatePiece::Expression(voe) => {
                let a = voe
                    .into_stream(providers)
                    .map(|v| (json_value_into_string(v.0), v.1));
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
    providers: BTreeSet<String>,
    special_providers: u16,
    send_behavior: EndpointProvidesSendOptions,
    select: ParsedSelect,
    where_clause: Option<Expression>,
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
    ) -> Result<Self, TestError> {
        let mut providers = BTreeSet::new();
        let mut special_providers = 0;
        let join = provides
            .for_each
            .iter()
            .map(|s| {
                let pairs = Parser::parse(Rule::entry_point, s)?;
                let e = parse_expression(pairs, &mut providers, static_providers)?;
                if providers.contains("for_each") {
                    Err(TestError::RecursiveForEachReference)
                } else {
                    ValueOrExpression::from_expression(e)
                }
            })
            .collect::<Result<_, _>>()?;
        let mut where_clause_special_providers = 0;
        let where_clause = provides
            .where_clause
            .as_ref()
            .map(|s| {
                let mut providers2 = BTreeSet::new();
                let pairs = Parser::parse(Rule::entry_point, s).map_err(TestError::PestParseErr)?;
                let e = parse_expression(pairs, &mut providers2, static_providers)?;
                providers_helper(&mut providers2, &mut where_clause_special_providers);
                providers.extend(providers2);
                Ok::<_, TestError>(e)
            })
            .transpose()?;
        special_providers |= where_clause_special_providers;
        let select = parse_select(provides.select, &mut providers, static_providers)?;
        providers_helper(&mut providers, &mut special_providers);
        Ok(Select {
            join,
            providers,
            special_providers,
            select,
            send_behavior: provides.send,
            where_clause,
            where_clause_special_providers,
        })
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

    pub fn execute_where(&self, d: &json::Value) -> Result<bool, TestError> {
        self.where_clause
            .as_ref()
            .map(|wc| bool_value(&*wc.evaluate(&d)?))
            .transpose()
            .map(|b| b.unwrap_or(true))
    }

    pub fn as_iter(
        &self,
        mut d: json::Value,
    ) -> Result<impl Iterator<Item = Result<json::Value, TestError>> + Clone, TestError> {
        let r = if self.join.is_empty() {
            if let Some(wc) = &self.where_clause {
                if bool_value(&*wc.evaluate(&d)?)? {
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
                    .map(|v| match v.evaluate_as_iter(&d) {
                        Ok(i) => Either::A(i),
                        Err(e) => Either::B(iter::once(Err(e))),
                    })
                    .multi_cartesian_product()
                    .map(move |v| {
                        if references_for_each {
                            d = d.clone();
                            let v: Result<_, _> = v.into_iter().collect();
                            d.as_object_mut()
                                .ok_or_else(|| {
                                    TestError::Internal("expected incoming json to be a map".into())
                                })?
                                .insert("for_each".to_string(), json::Value::Array(v?));
                        }
                        if let Some(wc) = where_clause.clone() {
                            if bool_value(&*wc.evaluate(&d)?)? {
                                Ok(Some(select.evaluate(&d)?))
                            } else {
                                Ok(None)
                            }
                        } else {
                            Ok(Some(select.evaluate(&d)?))
                        }
                    })
                    .filter_map(|v| v.transpose()),
            )
        };
        Ok(r)
    }
}

fn parse_select(
    select: json::Value,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> Result<ParsedSelect, TestError> {
    let r = match select {
        json::Value::Null => ParsedSelect::Null,
        json::Value::Bool(b) => ParsedSelect::Bool(b),
        json::Value::Number(n) => ParsedSelect::Number(n),
        json::Value::String(s) => {
            let expression = ValueOrExpression::new(&s, providers, static_providers)?;
            ParsedSelect::Expression(expression)
        }
        json::Value::Array(a) => {
            let new = a
                .into_iter()
                .map(|v| parse_select(v, providers, static_providers))
                .collect::<Result<_, _>>()?;
            ParsedSelect::Array(new)
        }
        json::Value::Object(m) => {
            let new = m
                .into_iter()
                .map(|(k, v)| {
                    Ok::<_, TestError>((k, parse_select(v, providers, static_providers)?))
                })
                .collect::<Result<_, _>>()?;
            ParsedSelect::Object(new)
        }
    };
    Ok(r)
}

fn parse_function_call(
    pair: Pair<'_, Rule>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> Result<Either<FunctionCall, json::Value>, TestError> {
    let mut ident = None;
    let mut args = Vec::new();
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::function_ident => {
                ident = Some(pair.as_str());
            }
            Rule::function_arg => {
                args.push(
                    parse_expression(pair.into_inner(), providers, static_providers)
                        .and_then(ValueOrExpression::from_expression)?,
                );
            }
            r => {
                return Err(TestError::Internal(
                    format!("Unexpected rule for function call, `{:?}`", r).into(),
                ));
            }
        }
    }
    FunctionCall::new(
        ident
            .ok_or_else(|| TestError::Internal("expected to have a function identifier".into()))?,
        args,
        providers,
        static_providers,
    )
}

fn parse_indexed_property(
    pair: Pair<'_, Rule>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> Result<PathSegment, TestError> {
    let pair = pair.into_inner().next().ok_or_else(|| {
        TestError::Internal("Expected 1 rule while parsing indexed property".into())
    })?;
    match pair.as_rule() {
        Rule::string => PathSegment::from_str(pair.as_str(), providers, static_providers),
        Rule::integer => Ok(PathSegment::Number(pair.as_str().parse().map_err(
            |_| {
                TestError::Internal(
                    "Expected rule to parse as a number while parsing indexed property".into(),
                )
            },
        )?)),
        r => Err(TestError::Internal(
            format!("Unexpected rule for path segment, `{:?}`", r).into(),
        )),
    }
}

fn parse_path(
    pair: Pair<'_, Rule>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> Result<Either<json::Value, Path>, TestError> {
    let mut start = None;
    let mut rest = Vec::new();
    let mut providers2 = BTreeSet::new();
    for pair in pair.into_inner() {
        match pair.as_rule() {
            Rule::function_call => {
                if start.is_none() {
                    let jps = match parse_function_call(pair, &mut providers2, static_providers)? {
                        Either::A(fc) => PathStart::FunctionCall(fc),
                        Either::B(v) => PathStart::Value(v),
                    };
                    start = Some(jps);
                } else {
                    return Err(TestError::Internal(
                        "Encountered unexpected function call while parsing path".into(),
                    ));
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
                    let ps =
                        PathSegment::from_str(pair.as_str(), &mut providers2, static_providers)?;
                    rest.push(ps);
                }
            }
            Rule::indexed_property => {
                if start.is_none() {
                    return Err(TestError::Internal(
                        "Encountered unexpected indexed property while parsing path".into(),
                    ));
                } else {
                    rest.push(parse_indexed_property(
                        pair,
                        &mut providers2,
                        static_providers,
                    )?);
                }
            }
            r => {
                return Err(TestError::Internal(
                    format!("Unexpected rule while parsing path, `{:?}`", r).into(),
                ));
            }
        }
    }
    let start = start.ok_or_else(|| {
        TestError::Internal("expected there to be a start piece while parsing path".into())
    })?;
    if let PathStart::Ident(s) = &start {
        match rest.first() {
            Some(PathSegment::String(next)) if &*s == "request" || &*s == "response" => {
                providers2.insert(format!("{}.{}", s, next));
            }
            _ => {
                providers2.insert(s.clone());
            }
        };
    }
    let p = Path { start, rest };
    let r = match p.start {
        PathStart::Value(_) if providers2.is_empty() => Either::A(p.evaluate(&json::Value::Null)?),
        _ => {
            providers.extend(providers2);
            Either::B(p)
        }
    };
    Ok(r)
}

fn parse_value(
    mut pairs: Pairs<'_, Rule>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> Result<Value, TestError> {
    let pair = pairs.next().ok_or_else(|| {
        TestError::Internal("Expected 1 rule while parsing indexed property".into())
    })?;
    let v = match pair.as_rule() {
        Rule::boolean => {
            let b = match pair.as_str() {
                "true" => true,
                "false" => false,
                s => {
                    return Err(TestError::Internal(
                        format!("Expected value to parse as a boolean. Saw `{}`", s).into(),
                    ));
                }
            };
            Value::Json(b.into())
        }
        Rule::null => Value::Json(json::Value::Null),
        Rule::json_path => match parse_path(pair, providers, static_providers)? {
            Either::A(v) => Value::Json(v),
            Either::B(p) => Value::Path(p.into()),
        },
        Rule::string => {
            let template = Template::new(pair.as_str(), static_providers)?;
            match template.simplify_to_string() {
                Either::A(s) => Value::Json(s.into()),
                Either::B(t) => {
                    providers.extend(t.get_providers().clone());
                    Value::Template(t)
                }
            }
        }
        Rule::integer | Rule::decimal => {
            let j =
                json::Value::Number(std::str::FromStr::from_str(pair.as_str()).map_err(|_| {
                    TestError::Internal("Expected value to parse as a number or decimal".into())
                })?);
            Value::Json(j)
        }
        r => {
            return Err(TestError::Internal(
                format!("Unexpected rule while parsing value: {:?}", r).into(),
            ));
        }
    };
    Ok(v)
}

#[derive(Debug)]
enum ExpressionOrOperator {
    Expression(Expression),
    Operator(InfixOperator),
}

fn expression_helper(
    mut items: Vec<ExpressionOrOperator>,
    level: u8,
) -> Result<Expression, TestError> {
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
                    return Err(TestError::Internal(
                        "expected an expression but found an operator".into(),
                    ));
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
                    Err(TestError::Internal(
                        "reached level 5 of operator precedence and found another operator".into(),
                    ))
                }
            } else {
                Err(TestError::Internal(
                    "reached level 5 of operator precedence and still had more than 1 element"
                        .into(),
                ))
            }
        }
        None => expression_helper(items, level + 1),
    }
}

fn parse_expression_pieces(
    pairs: Pairs<'_, Rule>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
    pieces: &mut Vec<ExpressionOrOperator>,
) -> Result<(), TestError> {
    let mut not_count = 0;
    let start_len = pieces.len();
    for pair in pairs {
        let rule = pair.as_rule();
        match rule {
            Rule::unary_operator => not_count += 1,
            Rule::value => {
                let v = parse_value(pair.into_inner(), providers, static_providers)?;
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
                        static_providers,
                        &mut pieces2,
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
                        static_providers,
                        pieces,
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
                        return Err(TestError::Internal(
                            format!(
                                "Unexpected operator while parsing simple expression: {:?}",
                                o
                            )
                            .into(),
                        ));
                    }
                };
                let eoo = ExpressionOrOperator::Operator(o);
                pieces.push(eoo);
            }
            Rule::EOI => (),
            r => {
                return Err(TestError::Internal(
                    format!("Unexpected rule while parsing expression: {:?}", r).into(),
                ));
            }
        }
    }
    Ok(())
}

fn parse_expression(
    pairs: Pairs<'_, Rule>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> Result<Expression, TestError> {
    let mut pieces = Vec::new();
    parse_expression_pieces(pairs, providers, static_providers, &mut pieces)?;
    expression_helper(pieces, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers;
    use futures::future::{join_all, lazy};
    use maplit::btreemap;
    use serde_json as json;
    use tokio::runtime::current_thread;

    fn check_results(select: json::Value, data: json::Value, expect: &[json::Value], i: usize) {
        let select = create_select(select);
        let result: Vec<_> = select
            .as_iter(data)
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(result.as_slice(), expect, "index {}", i)
    }

    fn create_select(json: json::Value) -> Select {
        let eppp = json::from_value(json).unwrap();
        Select::new(eppp, &Default::default()).unwrap()
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
            (json::json!("c[0].d + 1"), vec![json::json!(2)]),
            (json::json!("c[0].d - 1"), vec![json::json!(0)]),
            (json::json!("c[0].d * 1"), vec![json::json!(1)]),
            (json::json!("c[0].d / 2"), vec![json::json!(0.5)]),
            (json::json!("c[0].d + 2 * 2"), vec![json::json!(5)]),
            (json::json!("(c[0].d + 2) * 2"), vec![json::json!(6)]),
        ];

        for (i, (select, expect)) in check_table.into_iter().enumerate() {
            let data = data.clone();
            let s = json::json!({ "select": select });
            check_results(s, data, &expect, i);
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
                        json::Value::Array(v) => providers::literals(v.into()),
                        _ => providers::literals(vec![v].into()),
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
                let voe = ValueOrExpression::new(expr, &mut required_providers, &static_providers)
                    .unwrap();
                let fut = voe
                    .into_stream(&providers)
                    .map(|(v, _)| v)
                    .into_future()
                    .map(move |(v, _)| {
                        assert_eq!(v.unwrap(), expect, "index {}", i);
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

        // (statement, expect)
        let check_table = vec![
            (
                json::json!({
                    "select": "a",
                    "for_each": ["repeat(5)"]
                }),
                vec![
                    json::json!(3),
                    json::json!(3),
                    json::json!(3),
                    json::json!(3),
                    json::json!(3),
                ],
            ),
            (
                json::json!({
                    "select": "for_each[1]",
                    "for_each": ["repeat(3)", "true || false"]
                }),
                vec![true.into(), true.into(), true.into()],
            ),
            (
                json::json!({
                    "select": "for_each[0]",
                    "for_each": ["json_path('c.*.d')"]
                }),
                vec![json::json!(1), json::json!(2), json::json!(3)],
            ),
            (
                json::json!({
                    "select": "for_each[0]",
                    "for_each": ["c"]
                }),
                vec![
                    json::json!({ "d": 1 }),
                    json::json!({ "d": 2 }),
                    json::json!({ "d": 3 }),
                ],
            ),
            (
                json::json!({
                    "select": "for_each[1]",
                    "for_each": ["repeat(2)", r#"json_path("c.*.d")"#]
                }),
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
