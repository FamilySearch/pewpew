use super::select_parser::{bool_value, f64_value, AutoReturn, Value, ValueOrExpression};
use crate::error::TestError;
use crate::providers;
use crate::util::json_value_to_string;

use ether::{Either, Either3};
use futures::{stream, try_ready, Async, Future, IntoFuture, Stream};
use rand::distributions::{Distribution, Uniform};
use regex::Regex;
use serde_json as json;
use unicode_segmentation::UnicodeSegmentation;
use zip_all::zip_all;

use std::{
    borrow::Cow,
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
    env, fmt, iter,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug)]
pub(super) struct Collect {
    arg: ValueOrExpression,
    min: u64,
    random: Option<Uniform<u64>>,
}

impl Collect {
    pub(super) fn new(mut args: Vec<ValueOrExpression>) -> Result<Self, TestError> {
        match args.len() {
            2 | 3 => {
                let second = as_u64(&args.remove(1))
                    .ok_or_else(|| TestError::InvalidArguments("collect".into()))?;
                let first = args.remove(0);
                let third = args
                    .pop()
                    .map(|fa| {
                        let max = as_u64(&fa)
                            .ok_or_else(|| TestError::InvalidArguments("collect".into()));
                        Ok::<_, TestError>(Uniform::new(second, max?))
                    })
                    .transpose()?;
                Ok(Collect {
                    arg: first,
                    min: second,
                    random: third,
                })
            }
            _ => Err(TestError::InvalidArguments("collect".into())),
        }
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        self.arg.evaluate(d).map(Cow::into_owned)
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let mut value = None;
        let mut arg_stream = self.arg.into_stream(providers);
        let random = self.random;
        let min = self.min;
        stream::poll_fn(move || {
            if value.is_none() {
                let n = if let Some(r) = random {
                    r.sample(&mut rand::thread_rng())
                } else {
                    min
                };
                value = Some((Vec::with_capacity(n as usize), Vec::new()));
            }
            if let Some((ref mut jsons, ref mut returns)) = &mut value {
                loop {
                    if let Some((v, returns2)) = try_ready!(arg_stream.poll()) {
                        jsons.push(v);
                        returns.extend(returns2);
                        if jsons.len() == jsons.capacity() {
                            let value =
                                value.take().map(|(jsons, returns)| (jsons.into(), returns));
                            break Ok(Async::Ready(value));
                        }
                    } else {
                        break Ok(Async::Ready(None));
                    }
                }
            } else {
                Ok(Async::Ready(None))
            }
        })
    }
}

#[derive(Copy, Clone, Debug)]
enum Encoding {
    PercentSimple,
    PercentQuery,
    Percent,
    PercentPath,
    PercentUserinfo,
}

impl Encoding {
    fn encode(self, d: &json::Value) -> String {
        let s = json_value_to_string(&d);
        match self {
            Encoding::PercentSimple => {
                percent_encoding::utf8_percent_encode(&s, percent_encoding::SIMPLE_ENCODE_SET)
                    .to_string()
            }
            Encoding::PercentQuery => {
                percent_encoding::utf8_percent_encode(&s, percent_encoding::QUERY_ENCODE_SET)
                    .to_string()
            }
            Encoding::Percent => {
                percent_encoding::utf8_percent_encode(&s, percent_encoding::DEFAULT_ENCODE_SET)
                    .to_string()
            }
            Encoding::PercentPath => {
                percent_encoding::utf8_percent_encode(&s, percent_encoding::PATH_SEGMENT_ENCODE_SET)
                    .to_string()
            }
            Encoding::PercentUserinfo => {
                percent_encoding::utf8_percent_encode(&s, percent_encoding::USERINFO_ENCODE_SET)
                    .to_string()
            }
        }
    }

    fn try_from(s: &str) -> Result<Encoding, TestError> {
        match s {
            "percent-simple" => Ok(Encoding::PercentSimple),
            "percent-query" => Ok(Encoding::PercentQuery),
            "percent" => Ok(Encoding::Percent),
            "percent-path" => Ok(Encoding::PercentPath),
            "percent-userinfo" => Ok(Encoding::PercentUserinfo),
            _ => Err(TestError::InvalidEncoding(s.into())),
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct Encode {
    arg: ValueOrExpression,
    encoding: Encoding,
}

impl Encode {
    pub(super) fn new(
        mut args: Vec<ValueOrExpression>,
    ) -> Result<Either<Self, json::Value>, TestError> {
        match args.as_slice() {
            [_, ValueOrExpression::Value(Value::Json(json::Value::String(encoding)))] => {
                let encoding = Encoding::try_from(encoding.as_str())?;
                let e = Encode {
                    arg: args.remove(0),
                    encoding,
                };
                if let ValueOrExpression::Value(Value::Json(json)) = &e.arg {
                    Ok(Either::B(e.evaluate_with_arg(json)))
                } else {
                    Ok(Either::A(e))
                }
            }
            _ => Err(TestError::InvalidArguments("encode".into())),
        }
    }

    fn evaluate_with_arg(&self, d: &json::Value) -> json::Value {
        self.encoding.encode(d).into()
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        self.arg.evaluate(d).map(|v| self.evaluate_with_arg(&*v))
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let encoding = self.encoding;
        self.arg
            .into_stream(providers)
            .map(move |(d, returns)| (encoding.encode(&d).into(), returns))
    }
}

#[derive(Clone, Debug)]
pub struct Entries {
    arg: ValueOrExpression,
}

impl Entries {
    pub(super) fn new(mut args: Vec<ValueOrExpression>) -> Result<Self, TestError> {
        if args.len() == 1 {
            Ok(Entries {
                arg: args.remove(0),
            })
        } else {
            Err(TestError::InvalidArguments("entries".into()))
        }
    }

    fn evaluate_with_arg(
        d: json::Value,
    ) -> Either<json::Value, impl Iterator<Item = json::Value> + Clone> {
        let iter = match d {
            json::Value::Array(v) => {
                let a = v
                    .into_iter()
                    .enumerate()
                    .map(|(i, e)| json::Value::Array(vec![i.into(), e]));
                Either3::A(a)
            }
            json::Value::Object(o) => {
                let b = o
                    .into_iter()
                    .map(|(k, v)| json::Value::Array(vec![k.into(), v]))
                    .collect::<Vec<_>>()
                    .into_iter();
                Either3::B(b)
            }
            json::Value::String(s) => {
                let c = s
                    .graphemes(true)
                    .enumerate()
                    .map(|(i, c)| json::Value::Array(vec![i.into(), c.into()]))
                    .collect::<Vec<_>>()
                    .into_iter();
                Either3::C(c)
            }
            v => return Either::A(v),
        };
        Either::B(iter)
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        let v = self.arg.evaluate(d)?;
        let iter = Entries::evaluate_with_arg(v.into_owned()).map_a(iter::once);
        Ok(iter)
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        self.arg
            .evaluate(d)
            .map(|v| match Entries::evaluate_with_arg(v.into_owned()) {
                Either::A(v) => v,
                Either::B(b) => b.collect::<Vec<_>>().into(),
            })
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        self.arg.into_stream(providers).map(|(v, ar)| {
            let v = match Entries::evaluate_with_arg(v) {
                Either::A(v) => v,
                Either::B(b) => b.collect::<Vec<_>>().into(),
            };
            (v, ar)
        })
    }
}

#[derive(Copy, Clone, Debug)]
pub(super) enum Epoch {
    Seconds,
    Milliseconds,
    Microseconds,
    Nanoseconds,
}

impl Epoch {
    pub(super) fn new(args: Vec<ValueOrExpression>) -> Result<Self, TestError> {
        match args.as_slice() {
            [ValueOrExpression::Value(Value::Json(json::Value::String(unit)))] => {
                match unit.as_str() {
                    "s" => Ok(Epoch::Seconds),
                    "ms" => Ok(Epoch::Milliseconds),
                    "mu" => Ok(Epoch::Microseconds),
                    "ns" => Ok(Epoch::Nanoseconds),
                    _ => Err(TestError::InvalidArguments("epoch".into())),
                }
            }
            _ => Err(TestError::InvalidArguments("epoch".into())),
        }
    }

    pub(super) fn evaluate(self) -> Result<json::Value, TestError> {
        let start = SystemTime::now();
        let since_the_epoch = start
            .duration_since(UNIX_EPOCH)
            .map_err(|_| TestError::TimeSkew)?;
        let n = match self {
            Epoch::Seconds => u128::from(since_the_epoch.as_secs()),
            Epoch::Milliseconds => since_the_epoch.as_millis(),
            Epoch::Microseconds => since_the_epoch.as_micros(),
            Epoch::Nanoseconds => since_the_epoch.as_nanos(),
        };
        Ok(n.to_string().into())
    }

    pub(super) fn evaluate_as_iter(
        self,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate()?))
    }

    pub(super) fn into_stream(
        self,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let iter = iter::repeat_with(move || self.evaluate().map(|v| (v, Vec::new())));
        stream::iter_result(iter)
    }
}

#[derive(Clone, Debug)]
pub(super) struct If {
    first: ValueOrExpression,
    second: ValueOrExpression,
    third: ValueOrExpression,
}

impl If {
    pub(super) fn new(
        mut args: Vec<ValueOrExpression>,
    ) -> Result<Either<Self, json::Value>, TestError> {
        match args.len() {
            3 => {
                let third = args.pop().expect("should have had arg");
                let second = args.pop().expect("should have had arg");
                let first = args.pop().expect("should have had arg");
                match (first, second, third) {
                    (
                        ValueOrExpression::Value(Value::Json(first)),
                        ValueOrExpression::Value(Value::Json(second)),
                        _,
                    ) if bool_value(&first)? => Ok(Either::B(second)),
                    (
                        ValueOrExpression::Value(Value::Json(first)),
                        _,
                        ValueOrExpression::Value(Value::Json(third)),
                    ) if !bool_value(&first)? => Ok(Either::B(third)),
                    (first, second, third) => Ok(Either::A(If {
                        first,
                        second,
                        third,
                    })),
                }
            }
            _ => Err(TestError::InvalidArguments("if".into())),
        }
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        let first = self.first.evaluate(d)?;
        if bool_value(&*first)? {
            Ok(self.second.evaluate(d)?.into_owned())
        } else {
            Ok(self.third.evaluate(d)?.into_owned())
        }
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let mut first = self.first.into_stream(providers);
        let mut second = self.second.into_stream(providers);
        let mut third = self.third.into_stream(providers);
        let mut holder = None;
        stream::poll_fn(move || {
            if holder.is_none() {
                let r = try_ready!(first.poll());
                if let Some((v, returns)) = r {
                    let b = bool_value(&v)?;
                    holder = Some((b, returns));
                } else {
                    return Ok(Async::Ready(None));
                }
            }
            if let Some((b, returns)) = &mut holder {
                let s = if *b { &mut second } else { &mut third };
                let r = try_ready!(s.poll());
                if let Some((v, returns2)) = r {
                    returns.extend(returns2);
                    let value = holder.take().map(|(_, returns)| (v, returns));
                    Ok(Async::Ready(value))
                } else {
                    Ok(Async::Ready(None))
                }
            } else {
                Ok(Async::Ready(None))
            }
        })
    }
}

#[derive(Clone, Debug)]
pub(super) struct Join {
    arg: ValueOrExpression,
    sep: String,
    sep2: Option<String>,
}

impl Join {
    pub(super) fn new(
        mut args: Vec<ValueOrExpression>,
    ) -> Result<Either<Self, json::Value>, TestError> {
        match args.as_slice() {
            [_, ValueOrExpression::Value(Value::Json(json::Value::String(_)))] => {
                let two = into_string(args.pop().expect("join should have two args"))
                    .ok_or_else(|| TestError::InvalidArguments("join".into()))?;
                let one = args.pop().expect("join should have two args");
                if let ValueOrExpression::Value(Value::Json(json)) = &one {
                    Ok(Either::B(Join::evaluate_with_arg(&two, &None, json)))
                } else {
                    let j = Join {
                        arg: one,
                        sep: two,
                        sep2: None,
                    };
                    Ok(Either::A(j))
                }
            }
            [_, ValueOrExpression::Value(Value::Json(json::Value::String(_))), ValueOrExpression::Value(Value::Json(json::Value::String(_)))] =>
            {
                let three = into_string(args.pop().expect("join should have two args"))
                    .ok_or_else(|| TestError::InvalidArguments("join".into()))?;
                let two = into_string(args.pop().expect("join should have two args"))
                    .ok_or_else(|| TestError::InvalidArguments("join".into()))?;
                let one = args.pop().expect("join should have two args");
                if let ValueOrExpression::Value(Value::Json(json)) = &one {
                    Ok(Either::B(Join::evaluate_with_arg(&two, &Some(three), json)))
                } else {
                    let j = Join {
                        arg: one,
                        sep: two,
                        sep2: Some(three),
                    };
                    Ok(Either::A(j))
                }
            }
            _ => Err(TestError::InvalidArguments("join".into())),
        }
    }

    fn evaluate_with_arg(sep: &str, sep2: &Option<String>, d: &json::Value) -> json::Value {
        match (d, sep2) {
            (json::Value::Array(v), _) => v
                .iter()
                .map(|v| json_value_to_string(v).into_owned())
                .collect::<Vec<_>>()
                .as_slice()
                .join(sep)
                .into(),
            (json::Value::Object(m), Some(sep2)) => m
                .iter()
                .map(|(k, v)| format!("{}{}{}", k, sep2, json_value_to_string(v)))
                .collect::<Vec<_>>()
                .as_slice()
                .join(sep)
                .into(),
            _ => json_value_to_string(d).into_owned().into(),
        }
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        self.arg
            .evaluate(d)
            .map(|d| Join::evaluate_with_arg(&self.sep, &self.sep2, &*d))
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let sep = self.sep;
        let sep2 = self.sep2;
        self.arg
            .into_stream(providers)
            .map(move |(d, returns)| (Join::evaluate_with_arg(&sep, &sep2, &d), returns))
    }
}

#[derive(Clone)]
pub(super) struct JsonPath {
    provider: String,
    selector: Arc<jsonpath::Selector>,
}

impl fmt::Debug for JsonPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "JsonPath {{ provider: {} }}", self.provider)
    }
}

impl JsonPath {
    pub(super) fn new(
        args: Vec<ValueOrExpression>,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Result<Either<Self, json::Value>, TestError> {
        match args.as_slice() {
            [ValueOrExpression::Value(Value::Json(json::Value::String(json_path)))] => {
                let provider = {
                    // parse out the provider name, or if it's `request` or `response` get the second layer
                    let param_name_re = Regex::new(r"^((?:request\.|response\.)?[^\[.]*)").unwrap();
                    param_name_re
                        .captures(&*json_path)
                        .ok_or_else(|| TestError::InvalidJsonPathQuery(json_path.clone()))?
                        .get(1)
                        .expect("should have capture group")
                        .as_str()
                };
                // jsonpath requires the query to start with `$.`, so add it in
                let json_path2 = if json_path.starts_with('[') {
                    format!("${}", json_path)
                } else {
                    format!("$.{}", json_path)
                };
                let json_path = jsonpath::Selector::new(&json_path2)
                    .map_err(move |_| TestError::InvalidJsonPathQuery(json_path.clone()))?;
                let j = JsonPath {
                    provider: provider.into(),
                    selector: json_path.into(),
                };
                let v = match (provider.starts_with('$'), env::var(&provider[1..])) {
                    (true, Ok(s)) => {
                        Some(json::from_str(&s).unwrap_or_else(|_e| json::Value::String(s)))
                    }
                    _ => static_providers.get(provider).cloned(),
                };
                if let Some(v) = v {
                    let v = json::json!({ provider: v });
                    let v = j.evaluate(&v);
                    Ok(Either::B(v))
                } else {
                    providers.insert(provider.into());
                    Ok(Either::A(j))
                }
            }
            _ => Err(TestError::InvalidArguments("json_path".into())),
        }
    }

    fn evaluate_to_vec(&self, d: &json::Value) -> Vec<json::Value> {
        self.selector.find(d).cloned().collect()
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> json::Value {
        let v = self.evaluate_to_vec(d);
        json::Value::Array(v)
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        self.evaluate_to_vec(d).into_iter()
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let provider_name = self.provider.clone();
        providers
            .get(&self.provider)
            .map(move |provider| {
                let auto_return = provider.auto_return.map(|ar| (ar, provider.tx.clone()));
                provider
                    .rx
                    .clone()
                    .map_err(move |_| TestError::Internal("unexpected error from provider".into()))
                    .map(move |v| {
                        let outgoing = if let Some((ar, tx)) = &auto_return {
                            vec![AutoReturn::new(*ar, tx.clone(), vec![v.clone()])]
                        } else {
                            Vec::new()
                        };
                        let v = json::json!({ self.provider.as_str(): &v });
                        let result = self.evaluate(&v);
                        (result, outgoing)
                    })
            })
            .ok_or_else(move || TestError::UnknownProvider(provider_name.clone()))
            .into_future()
            .flatten_stream()
    }
}

#[derive(Clone, Debug)]
pub(super) struct Match {
    arg: ValueOrExpression,
    capture_names: Vec<String>,
    regex: Regex,
}

impl Match {
    pub(super) fn new(
        args: Vec<ValueOrExpression>,
    ) -> Result<Either<Self, json::Value>, TestError> {
        match args.as_slice() {
            [_, ValueOrExpression::Value(Value::Json(json::Value::String(regex_str)))] => {
                let regex = Regex::new(regex_str).map_err(TestError::RegexErr)?;
                let capture_names: Vec<_> = regex
                    .capture_names()
                    .enumerate()
                    .map(|(i, n)| n.map(|s| s.into()).unwrap_or_else(|| i.to_string()))
                    .collect();
                let arg = args.into_iter().nth(0).expect("match should have two args");
                if let ValueOrExpression::Value(Value::Json(json)) = &arg {
                    Ok(Either::B(Match::evaluate_with_arg(
                        &regex,
                        &capture_names,
                        json,
                    )))
                } else {
                    let m = Match {
                        arg,
                        capture_names,
                        regex,
                    };
                    Ok(Either::A(m))
                }
            }
            _ => Err(TestError::InvalidArguments("match".into())),
        }
    }

    fn evaluate_with_arg(regex: &Regex, capture_names: &[String], d: &json::Value) -> json::Value {
        let search_str = json_value_to_string(d);
        if let Some(captures) = regex.captures(&*search_str) {
            let map: json::Map<String, json::Value> = capture_names
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

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        self.arg
            .evaluate(d)
            .map(|d| Match::evaluate_with_arg(&self.regex, &self.capture_names, &*d))
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let capture_names = self.capture_names;
        let regex = self.regex;
        self.arg.into_stream(providers).map(move |(d, returns)| {
            (
                Match::evaluate_with_arg(&regex, &capture_names, &d),
                returns,
            )
        })
    }
}

#[derive(Clone, Debug)]
pub(super) struct MinMax {
    args: Vec<ValueOrExpression>,
    min: bool,
}

impl MinMax {
    pub(super) fn new(
        min: bool,
        args: Vec<ValueOrExpression>,
    ) -> Result<Either<Self, json::Value>, TestError> {
        let m = MinMax { args, min };
        let iter = m.args.iter().filter_map(|fa| {
            if let ValueOrExpression::Value(Value::Json(json)) = fa {
                Some(Ok(Cow::Borrowed(json)))
            } else {
                None
            }
        });
        let (v, count) = MinMax::eval_iter(m.min, iter)?;
        if count == m.args.len() {
            Ok(Either::B(v.into_owned()))
        } else {
            Ok(Either::A(m))
        }
    }

    fn eval_iter<'a, I: Iterator<Item = Result<Cow<'a, json::Value>, TestError>>>(
        min: bool,
        mut iter: I,
    ) -> Result<(Cow<'a, json::Value>, usize), TestError> {
        iter.try_fold(
            (Cow::Owned(json::Value::Null), 0),
            |(left, count), right| {
                let right = right?;
                let l = f64_value(&*left);
                let r = f64_value(&*right);
                let v = match (l.partial_cmp(&r), min, l.is_finite()) {
                    (Some(Ordering::Less), true, _)
                    | (Some(Ordering::Greater), false, _)
                    | (None, _, true) => left,
                    _ if r.is_finite() => right,
                    _ => Cow::Owned(json::Value::Null),
                };
                Ok((v, count + 1))
            },
        )
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        let iter = self.args.iter().map(|fa| fa.evaluate(d));
        MinMax::eval_iter(self.min, iter).map(|d| d.0.into_owned())
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        self.evaluate(d).map(iter::once)
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let streams = self.args.into_iter().map(|fa| fa.into_stream(providers));
        let min = self.min;
        zip_all(streams).and_then(move |values| {
            let iter = values.iter().map(|v| Ok(Cow::Borrowed(&v.0)));
            let v = MinMax::eval_iter(min, iter)?.0.into_owned();
            let returns = values.into_iter().map(|v| v.1).flatten().collect();
            Ok((v, returns))
        })
    }
}

#[derive(Clone, Debug)]
pub(super) struct Pad {
    start: bool,
    arg: ValueOrExpression,
    min_length: usize,
    padding: String,
}

impl Pad {
    pub(super) fn new(
        start: bool,
        mut args: Vec<ValueOrExpression>,
    ) -> Result<Either<Self, json::Value>, TestError> {
        let as_usize = |fa| match fa {
            ValueOrExpression::Value(Value::Json(json::Value::Number(ref n))) if n.is_u64() => n
                .as_u64()
                .map(|n| n as usize)
                .ok_or_else(|| TestError::InvalidArguments("pad".into())),
            _ => Err(TestError::InvalidArguments("pad".into())),
        };
        match args.as_slice() {
            [_, ValueOrExpression::Value(Value::Json(json::Value::Number(_))), ValueOrExpression::Value(Value::Json(json::Value::String(_)))] =>
            {
                let third = into_string(args.pop().expect("pad should have three args"))
                    .ok_or_else(|| TestError::InvalidArguments("pad".into()))?;
                let second = as_usize(args.pop().expect("pad should have three args"))?;
                let first = args.pop().expect("pad should have three args");
                if let ValueOrExpression::Value(Value::Json(json)) = &first {
                    Ok(Either::B(Pad::evaluate_with_arg(
                        &third, second, start, json,
                    )))
                } else {
                    let p = Pad {
                        start,
                        arg: first,
                        min_length: second,
                        padding: third,
                    };
                    Ok(Either::A(p))
                }
            }
            _ => Err(TestError::InvalidArguments("pad".into())),
        }
    }

    fn evaluate_with_arg(
        pad_str: &str,
        min_length: usize,
        start: bool,
        d: &json::Value,
    ) -> json::Value {
        let string_to_pad = json_value_to_string(&d);
        let str_len = string_to_pad.graphemes(true).count();
        let diff = min_length.saturating_sub(str_len);
        let mut pad_str: String = pad_str.graphemes(true).cycle().take(diff).collect();
        let output = if start {
            pad_str.push_str(&string_to_pad);
            pad_str
        } else {
            let mut string_to_pad = string_to_pad.into_owned();
            string_to_pad.push_str(pad_str.as_str());
            string_to_pad
        };
        output.into()
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        self.arg
            .evaluate(d)
            .map(|d| Pad::evaluate_with_arg(&self.padding, self.min_length, self.start, &*d))
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let padding = self.padding;
        let min_length = self.min_length;
        let start = self.start;
        self.arg.into_stream(providers).map(move |(d, returns)| {
            (
                Pad::evaluate_with_arg(&padding, min_length, start, &d),
                returns,
            )
        })
    }
}

#[derive(Clone, Debug)]
pub enum Random {
    Integer(Uniform<u64>),
    Float(Uniform<f64>),
}

impl Random {
    pub(super) fn new(args: Vec<ValueOrExpression>) -> Result<Self, TestError> {
        match args.as_slice() {
            [ValueOrExpression::Value(Value::Json(json::Value::Number(first))), ValueOrExpression::Value(Value::Json(json::Value::Number(second)))] => {
                if first.is_u64() && second.is_u64() {
                    let r = Uniform::new(
                        first.as_u64().expect("should have been u64"),
                        second.as_u64().expect("should have been u64"),
                    );
                    Ok(Random::Integer(r))
                } else {
                    let r = Uniform::new(
                        first.as_f64().expect("should have been f64"),
                        second.as_f64().expect("should have been f64"),
                    );
                    Ok(Random::Float(r))
                }
            }
            _ => Err(TestError::InvalidArguments("random".into())),
        }
    }

    pub(super) fn evaluate(&self) -> json::Value {
        match self {
            Random::Integer(r) => r.sample(&mut rand::thread_rng()).into(),
            Random::Float(r) => r.sample(&mut rand::thread_rng()).into(),
        }
    }

    pub(super) fn evaluate_as_iter(&self) -> impl Iterator<Item = json::Value> + Clone {
        iter::once(self.evaluate())
    }

    pub(super) fn into_stream(
        self,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        stream::iter_ok(iter::repeat_with(move || (self.evaluate(), Vec::new())))
    }
}

#[derive(Clone, Debug)]
pub(super) struct ReversibleRange {
    range: std::ops::Range<u64>,
    reverse: bool,
}

impl ReversibleRange {
    fn new(first: u64, second: u64) -> Self {
        let reverse = first > second;
        let range = if reverse {
            #[allow(clippy::range_plus_one)]
            {
                second + 1..first + 1
            }
        } else {
            first..second
        };
        ReversibleRange { range, reverse }
    }

    fn into_iter(self) -> impl Iterator<Item = json::Value> + Clone {
        let i = if self.reverse {
            Either::A(self.range.rev())
        } else {
            Either::B(self.range)
        };
        i.map(Into::into)
    }
}

#[derive(Clone, Debug)]
pub(super) enum Range {
    Args(ValueOrExpression, ValueOrExpression),
    Range(ReversibleRange),
}

impl Range {
    pub(super) fn new(mut args: Vec<ValueOrExpression>) -> Result<Self, TestError> {
        if args.len() == 2 {
            let second = args.pop().expect("range should have two args");
            let first = args.pop().expect("range should have two args");
            match (&first, &second) {
                (
                    ValueOrExpression::Value(Value::Json(_)),
                    ValueOrExpression::Value(Value::Json(_)),
                ) => {
                    let first = as_u64(&first)
                        .ok_or_else(|| TestError::InvalidArguments("range".into()))?;
                    let second = as_u64(&second)
                        .ok_or_else(|| TestError::InvalidArguments("range".into()))?;
                    Ok(Range::Range(ReversibleRange::new(first, second)))
                }
                _ => Ok(Range::Args(first, second)),
            }
        } else {
            Err(TestError::InvalidArguments("range".into()))
        }
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        Ok(json::Value::Array(self.evaluate_as_iter(d)?.collect()))
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        let r = match self {
            Range::Args(first, second) => {
                let first = first
                    .evaluate(d)?
                    .as_u64()
                    .ok_or_else(|| TestError::InvalidArguments("range".into()))?;
                let second = second
                    .evaluate(d)?
                    .as_u64()
                    .ok_or_else(|| TestError::InvalidArguments("range".into()))?;
                ReversibleRange::new(first, second)
            }
            Range::Range(r) => r.clone(),
        };
        Ok(r.into_iter())
    }

    pub(super) fn into_stream(
        self,
        providers: &BTreeMap<String, providers::Provider>,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        match self {
            Range::Args(first, second) => {
                let a = first
                    .into_stream(providers)
                    .zip(second.into_stream(providers))
                    .and_then(|((first, mut returns), (second, returns2))| {
                        let first = first
                            .as_u64()
                            .ok_or_else(|| TestError::InvalidArguments("range".into()))?;
                        let second = second
                            .as_u64()
                            .ok_or_else(|| TestError::InvalidArguments("range".into()))?;
                        let v = json::Value::Array(
                            ReversibleRange::new(first, second).into_iter().collect(),
                        );
                        returns.extend(returns2);
                        Ok((v, returns))
                    });
                Either::A(a)
            }
            Range::Range(..) => {
                let r = self.evaluate(&json::Value::Null).map(|v| (v, Vec::new()));
                Either::B(stream::iter_result(iter::repeat(r)))
            }
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct Repeat {
    min: u64,
    random: Option<Uniform<u64>>,
}

impl Repeat {
    pub(super) fn new(mut args: Vec<ValueOrExpression>) -> Result<Self, TestError> {
        match args.len() {
            1 | 2 => {
                let min = as_u64(&args.remove(0))
                    .ok_or_else(|| TestError::InvalidArguments("repeat".into()))?;
                let random = args
                    .pop()
                    .map(|fa| {
                        let max =
                            as_u64(&fa).ok_or_else(|| TestError::InvalidArguments("repeat".into()));
                        Ok::<_, TestError>(Uniform::new(min, max?))
                    })
                    .transpose()?;
                Ok(Repeat { min, random })
            }
            _ => Err(TestError::InvalidArguments("repeat".into())),
        }
    }

    pub(super) fn evaluate(&self) -> json::Value {
        json::Value::Array(self.evaluate_as_iter().collect())
    }

    pub(super) fn evaluate_as_iter(&self) -> impl Iterator<Item = json::Value> + Clone {
        let n = if let Some(r) = self.random {
            r.sample(&mut rand::thread_rng())
        } else {
            self.min
        };
        iter::repeat(json::Value::Null).take(n as usize)
    }

    pub(super) fn into_stream(
        self,
    ) -> impl Stream<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        stream::repeat((self.evaluate(), Vec::new()))
    }
}

fn into_string(fa: ValueOrExpression) -> Option<String> {
    if let ValueOrExpression::Value(Value::Json(json::Value::String(s))) = fa {
        Some(s)
    } else {
        None
    }
}

fn as_u64(fa: &ValueOrExpression) -> Option<u64> {
    match fa {
        ValueOrExpression::Value(Value::Json(json::Value::Number(ref n))) if n.is_u64() => {
            n.as_u64()
        }
        ValueOrExpression::Value(Value::Json(json::Value::Number(ref n))) if n.is_f64() => {
            n.as_f64().map(|n| n as u64)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::select_parser::{Path, PathStart};
    use super::*;
    use crate::providers::literals;
    use crate::util::json_value_into_string;

    use futures::future::{join_all, lazy};
    use maplit::{btreemap, btreeset};
    use serde_json::json as j;
    use tokio::runtime::current_thread;

    impl From<json::Value> for ValueOrExpression {
        fn from(j: json::Value) -> Self {
            ValueOrExpression::Value(Value::Json(j))
        }
    }

    impl From<&str> for ValueOrExpression {
        fn from(s: &str) -> Self {
            ValueOrExpression::Value(Value::Path(
                Path {
                    start: PathStart::Ident(s.into()),
                    rest: vec![],
                }
                .into(),
            ))
        }
    }

    #[test]
    fn collect_eval() {
        // constructor args, expect
        let checks = vec![
            (vec![j!(45), j!(5)], j!(45)),
            (vec![j!(45), j!(5), j!(89)], j!(45)),
        ];

        for (args, right) in checks.into_iter() {
            let args = args.into_iter().map(Into::into).collect();
            let c = Collect::new(args).unwrap();
            let left = c.evaluate(&json::Value::Null).unwrap();
            assert_eq!(left, right);
        }
    }

    #[test]
    fn collect_eval_iter() {
        // constructor args, expect
        let checks = vec![
            (vec![j!(45), j!(5)], vec![j!(45)]),
            (vec![j!(45), j!(5), j!(89)], vec![j!(45)]),
        ];

        for (args, right) in checks.into_iter() {
            let args = args.into_iter().map(Into::into).collect();
            let c = Collect::new(args).unwrap();
            let left: Vec<_> = c.evaluate_as_iter(&json::Value::Null).unwrap().collect();
            assert_eq!(left, right);
        }
    }

    #[test]
    fn collect_into_stream() {
        // constructor args, expect, range
        let checks = vec![
            (vec!["a".into(), j!(3).into()], j!([45, 45, 45]), None),
            (
                vec!["a".into(), j!(1).into(), j!(3).into()],
                j!(45),
                Some((1, 3)),
            ),
        ];
        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(45)).into())
            );

            let providers = Arc::new(providers);
            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right, range)| {
                    let c = Collect::new(args).unwrap();
                    c.into_stream(&providers).into_future().map(move |(v, _)| {
                        let (left, _) = v.unwrap();
                        if let Some((min, max)) = range {
                            if let json::Value::Array(v) = left {
                                let len = v.len();
                                assert!(len >= min && min <= max);
                                for left in v {
                                    assert_eq!(left, right)
                                }
                            } else {
                                unreachable!()
                            }
                        } else {
                            assert_eq!(left, right);
                        }
                    })
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn encode_eval() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (
                vec![j!("asd/jkl%").into(), j!("percent-path").into()],
                None,
                j!("asd%2Fjkl%25"),
            ),
            (
                vec![j!("asd\njkl#").into(), j!("percent-simple").into()],
                None,
                j!("asd%0Ajkl#"),
            ),
            (
                vec![j!("asd\njkl{").into(), j!("percent-query").into()],
                None,
                j!("asd%0Ajkl{"),
            ),
            (
                vec![j!("asd jkl|").into(), j!("percent-userinfo").into()],
                None,
                j!("asd%20jkl%7C"),
            ),
            (
                vec!["a".into(), j!("percent-path").into()],
                Some(j!({"a": "asd/jkl%"})),
                j!("asd%2Fjkl%25"),
            ),
            (
                vec!["a".into(), j!("percent-simple").into()],
                Some(j!({"a": "asd\njkl#"})),
                j!("asd%0Ajkl#"),
            ),
            (
                vec!["a".into(), j!("percent-query").into()],
                Some(j!({"a": "asd\njkl{"})),
                j!("asd%0Ajkl{"),
            ),
            (
                vec!["a".into(), j!("percent-userinfo").into()],
                Some(j!({"a": "asd jkl|"})),
                j!("asd%20jkl%7C"),
            ),
        ];

        for (args, eval, right) in checks.into_iter() {
            match (eval, Encode::new(args).unwrap()) {
                (Some(eval), Either::A(e)) => {
                    let left = e.evaluate(&eval).unwrap();
                    assert_eq!(left, right)
                }
                (None, Either::B(left)) => assert_eq!(left, right),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn encode_eval_iter() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (
                vec!["a".into(), j!("percent-path").into()],
                j!({"a": "asd/jkl%"}),
                vec![j!("asd%2Fjkl%25")],
            ),
            (
                vec!["a".into(), j!("percent-simple").into()],
                j!({"a": "asd\njkl#"}),
                vec![j!("asd%0Ajkl#")],
            ),
            (
                vec!["a".into(), j!("percent-query").into()],
                j!({"a": "asd\njkl{"}),
                vec![j!("asd%0Ajkl{")],
            ),
            (
                vec!["a".into(), j!("percent-userinfo").into()],
                j!({"a": "asd jkl|"}),
                vec![j!("asd%20jkl%7C")],
            ),
        ];

        for (args, eval, right) in checks.into_iter() {
            match Encode::new(args).unwrap() {
                Either::A(e) => {
                    let left: Vec<_> = e.evaluate_as_iter(&eval).unwrap().collect();
                    assert_eq!(left, right)
                }
                Either::B(_) => unreachable!(),
            }
        }
    }

    #[test]
    fn encode_into_stream() {
        // constructor args, expect
        let checks = vec![
            (
                vec!["a".into(), j!("percent-path").into()],
                j!("asd%2Fjkl%25"),
            ),
            (
                vec!["b".into(), j!("percent-simple").into()],
                j!("asd%0Ajkl#"),
            ),
            (
                vec!["c".into(), j!("percent-query").into()],
                j!("asd%0Ajkl{"),
            ),
            (
                vec!["d".into(), j!("percent-userinfo").into()],
                j!("asd%20jkl%7C"),
            ),
        ];

        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!("asd/jkl%")).into()),
                "b".to_string() => literals(vec!(j!("asd\njkl#")).into()),
                "c".to_string() => literals(vec!(j!("asd\njkl{")).into()),
                "d".to_string() => literals(vec!(j!("asd jkl|")).into()),
            );

            let providers = Arc::new(providers);

            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right)| match Encode::new(args).unwrap() {
                    Either::A(e) => e
                        .into_stream(&providers)
                        .into_future()
                        .map(move |(v, _)| assert_eq!(v.unwrap().0, right)),
                    Either::B(_) => unreachable!(),
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn entries_eval() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (
                vec![j!("foo").into()],
                None,
                j!([[0, "f"], [1, "o"], [2, "o"]]),
            ),
            (vec![j!(null).into()], None, j!(null)),
            (vec![j!(false).into()], None, j!(false)),
            (
                vec!["a".into()],
                Some(j!({"a": {"foo": "bar", "abc": 123}})),
                j!([["abc", 123], ["foo", "bar"]]),
            ),
            (
                vec!["a".into()],
                Some(j!({"a": [1, 2, 3]})),
                j!([[0, 1], [1, 2], [2, 3]]),
            ),
        ];

        for (args, eval, right) in checks.into_iter() {
            let e = Entries::new(args).unwrap();
            let eval = eval.unwrap_or(json::Value::Null);
            let left = e.evaluate(&eval).unwrap();
            assert_eq!(left, right)
        }
    }

    #[test]
    fn entries_eval_iter() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (
                vec![j!("foo").into()],
                None,
                vec![j!([0, "f"]), j!([1, "o"]), j!([2, "o"])],
            ),
            (vec![j!(null).into()], None, vec![j!(null)]),
            (vec![j!(false).into()], None, vec![j!(false)]),
            (
                vec!["a".into()],
                Some(j!({"a": {"foo": "bar", "abc": 123}})),
                vec![j!(["abc", 123]), j!(["foo", "bar"])],
            ),
            (
                vec!["a".into()],
                Some(j!({"a": [1, 2, 3]})),
                vec![j!([0, 1]), j!([1, 2]), j!([2, 3])],
            ),
        ];

        for (args, eval, right) in checks.into_iter() {
            let e = Entries::new(args).unwrap();
            let eval = eval.unwrap_or(json::Value::Null);
            let left: Vec<_> = e.evaluate_as_iter(&eval).unwrap().collect();
            assert_eq!(left, right)
        }
    }

    #[test]
    fn entries_into_stream() {
        // constructor args, expect
        let checks = vec![
            (vec![j!("foo").into()], j!([[0, "f"], [1, "o"], [2, "o"]])),
            (vec![j!(null).into()], j!(null)),
            (vec![j!(false).into()], j!(false)),
            (vec!["a".into()], j!([["abc", 123], ["foo", "bar"]])),
            (vec!["b".into()], j!([[0, 1], [1, 2], [2, 3]])),
        ];

        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!({"foo": "bar", "abc": 123})).into()),
                "b".to_string() => literals(vec!(j!([1, 2, 3])).into()),
            );

            let providers = Arc::new(providers);

            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right)| {
                    Entries::new(args)
                        .unwrap()
                        .into_stream(&providers)
                        .into_future()
                        .map(move |(v, _)| assert_eq!(v.unwrap().0, right))
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn epoch_eval() {
        // constructor args
        let checks = vec![j!("s"), j!("ms"), j!("mu"), j!("ns")];

        for arg in checks.into_iter() {
            let e = Epoch::new(vec![arg.into()]).unwrap();
            let left = json_value_into_string(e.evaluate().unwrap())
                .parse::<u128>()
                .unwrap();
            let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
            let (allowable_dif, right) = match e {
                Epoch::Seconds => (1, u128::from(epoch.as_secs())),
                Epoch::Milliseconds => (500, epoch.as_millis()),
                Epoch::Microseconds => (500_000, epoch.as_micros()),
                Epoch::Nanoseconds => (500_000_000, epoch.as_nanos()),
            };
            assert!(
                right - left < allowable_dif,
                "right: {}, left: {}, allowable dif: {}",
                right,
                left,
                allowable_dif
            );
        }
    }

    #[test]
    fn epoch_eval_iter() {
        // constructor args
        let checks = vec![j!("s"), j!("ms"), j!("mu"), j!("ns")];

        for arg in checks.into_iter() {
            let e = Epoch::new(vec![arg.into()]).unwrap();
            let mut left: Vec<_> = e.evaluate_as_iter().unwrap().collect();
            assert_eq!(left.len(), 1);
            let left = json_value_into_string(left.pop().unwrap())
                .parse::<u128>()
                .unwrap();
            let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
            let (allowable_dif, right) = match e {
                Epoch::Seconds => (1, u128::from(epoch.as_secs())),
                Epoch::Milliseconds => (500, epoch.as_millis()),
                Epoch::Microseconds => (500_000, epoch.as_micros()),
                Epoch::Nanoseconds => (500_000_000, epoch.as_nanos()),
            };
            assert!(
                right - left < allowable_dif,
                "right: {}, left: {}, allowable dif: {}",
                right,
                left,
                allowable_dif
            );
        }
    }

    #[test]
    fn epoch_into_stream() {
        // constructor args
        let checks = vec![j!("s"), j!("ms"), j!("mu"), j!("ns")];

        current_thread::run(lazy(move || {
            let futures: Vec<_> = checks
                .into_iter()
                .map(|arg| {
                    let e = Epoch::new(vec![arg.into()]).unwrap();
                    e.into_stream().into_future().map(move |(v, _)| {
                        let (left, _) = v.unwrap();
                        let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
                        let (allowable_dif, right) = match e {
                            Epoch::Seconds => (1, u128::from(epoch.as_secs())),
                            Epoch::Milliseconds => (500, epoch.as_millis()),
                            Epoch::Microseconds => (500_000, epoch.as_micros()),
                            Epoch::Nanoseconds => (500_000_000, epoch.as_nanos()),
                        };
                        let left = json_value_into_string(left).parse::<u128>().unwrap();
                        assert!(
                            right - left < allowable_dif,
                            "right: {}, left: {}, allowable dif: {}",
                            right,
                            left,
                            allowable_dif
                        );
                    })
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn if_eval() {
        // constructor args, expect
        let checks = vec![
            (vec![j!(true).into(), j!(1).into(), j!(2).into()], j!(1)),
            (vec![j!(false).into(), j!(1).into(), j!(2).into()], j!(2)),
        ];

        for (args, expect) in checks.into_iter() {
            match If::new(args).unwrap() {
                Either::A(_) => unreachable!(),
                Either::B(v) => assert_eq!(v, expect),
            }
        }
    }

    #[test]
    fn if_eval_iter() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (
                vec!["a".into(), j!(1).into(), j!(2).into()],
                j!({ "a": true }),
                vec![j!(1)],
            ),
            (
                vec!["a".into(), j!(1).into(), j!(2).into()],
                j!({ "a": false }),
                vec![j!(2)],
            ),
        ];

        for (args, eval_arg, expect) in checks.into_iter() {
            let i = match If::new(args).unwrap() {
                Either::A(i) => i,
                Either::B(_) => unreachable!(),
            };
            let left: Vec<_> = i.evaluate_as_iter(&eval_arg).unwrap().collect();
            assert_eq!(left, expect);
        }
    }

    #[test]
    fn if_into_stream() {
        // constructor args, expect
        let checks = vec![
            (vec!["a".into(), j!(1).into(), j!(2).into()], j!(1)),
            (vec!["b".into(), j!(1).into(), j!(2).into()], j!(2)),
        ];

        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(true)).into()),
                "b".to_string() => literals(vec!(j!(false)).into()),
            );

            let providers = Arc::new(providers);

            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right)| match If::new(args).unwrap() {
                    Either::A(e) => e
                        .into_stream(&providers)
                        .into_future()
                        .map(move |(v, _)| assert_eq!(v.unwrap().0, right)),
                    Either::B(_) => unreachable!(),
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn join_eval() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (
                vec![j!(["foo", "bar", "baz"]).into(), j!("-").into()],
                None,
                j!("foo-bar-baz"),
            ),
            (vec![j!(1).into(), j!(",").into()], None, j!("1")),
            (
                vec![j!(["foo", null, "baz"]).into(), j!("&").into()],
                None,
                j!("foo&null&baz"),
            ),
            (
                vec!["a".into(), j!("-").into()],
                Some(j!({ "a": ["foo", "bar", "baz"] })),
                j!("foo-bar-baz"),
            ),
            (
                vec!["a".into(), j!(",").into()],
                Some(j!({ "a": 1 })),
                j!("1"),
            ),
            (
                vec!["a".into(), j!("&").into()],
                Some(j!({ "a": ["foo", null, "baz"] })),
                j!("foo&null&baz"),
            ),
            (
                vec!["a".into(), j!("\n").into(), j!(": ").into()],
                Some(j!({ "a": { "b": "c", "d": "e" } })),
                j!("b: c\nd: e"),
            ),
        ];

        for (args, eval, right) in checks.into_iter() {
            match (eval, Join::new(args).unwrap()) {
                (Some(eval), Either::A(e)) => {
                    let left = e.evaluate(&eval).unwrap();
                    assert_eq!(left, right)
                }
                (None, Either::B(left)) => assert_eq!(left, right),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn join_eval_iter() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (
                vec!["a".into(), j!("-").into()],
                j!({ "a": ["foo", "bar", "baz"] }),
                j!("foo-bar-baz"),
            ),
            (vec!["a".into(), j!(",").into()], j!({ "a": 1 }), j!("1")),
            (
                vec!["a".into(), j!("&").into()],
                j!({ "a": ["foo", null, "baz"] }),
                j!("foo&null&baz"),
            ),
        ];

        for (args, eval, right) in checks.into_iter() {
            match Join::new(args).unwrap() {
                Either::A(e) => {
                    let left: Vec<_> = e.evaluate_as_iter(&eval).unwrap().collect();
                    assert_eq!(left, vec!(right))
                }
                Either::B(_) => unreachable!(),
            }
        }
    }

    #[test]
    fn join_into_stream() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (vec!["a".into(), j!("-").into()], j!("foo-bar-baz")),
            (vec!["b".into(), j!(",").into()], j!("1")),
            (vec!["c".into(), j!("&").into()], j!("foo&null&baz")),
        ];

        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(["foo", "bar", "baz"])).into()),
                "b".to_string() => literals(vec!(j!(1)).into()),
                "c".to_string() => literals(vec!(j!(["foo", null, "baz"])).into()),
            );

            let providers = Arc::new(providers);
            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right)| match Join::new(args).unwrap() {
                    Either::A(j) => j.into_stream(&providers).into_future().map(move |(v, _)| {
                        assert_eq!(v.unwrap().0, right);
                    }),
                    Either::B(_) => unreachable!(),
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn json_path_eval() {
        std::env::set_var("ZED", "[26]");
        // constructor args, eval_arg, expect response, expect providers
        let checks = vec![
            (
                j!("a.b.c"),
                j!({ "a": { "b": {"c": 1 } } }),
                j!([1]),
                btreeset!["a".to_string()],
            ),
            (
                j!("a.b.*.id"),
                j!({ "a": { "b": [{ "id": 0 }, { "id": 1 }] } }),
                j!([0, 1]),
                btreeset!["a".to_string()],
            ),
            // this should work but apparently the json_path library can't handle it
            // (
            //     j!("['$ZED'].*"),
            //     j!(null),
            //     j!([26]),
            //     btreeset![],
            // ),
        ];
        for do_static in [false, true].iter() {
            for (arg, eval, right, providers_expect) in checks.iter() {
                let mut providers = BTreeSet::new();
                let static_providers = if *do_static {
                    eval.as_object().unwrap().clone().into_iter().collect()
                } else {
                    BTreeMap::new()
                };
                match (
                    *do_static,
                    JsonPath::new(vec![arg.clone().into()], &mut providers, &static_providers)
                        .unwrap(),
                ) {
                    (false, Either::A(j)) => {
                        assert_eq!(&providers, providers_expect);
                        let left = j.evaluate(eval);
                        assert_eq!(&left, right)
                    }
                    (true, Either::B(left)) => {
                        assert_eq!(providers.len(), 0);
                        assert_eq!(&left, right)
                    }
                    _ => unreachable!(),
                }
            }
        }
    }

    #[test]
    fn json_path_eval_iter() {
        // constructor args, eval_arg, expect response, expect providers
        let checks = vec![
            (
                j!("a.b.c"),
                j!({ "a": { "b": {"c": 1 } } }),
                vec![j!(1)],
                btreeset!["a".to_string()],
            ),
            (
                j!("a.b.*.id"),
                j!({ "a": { "b": [{ "id": 0 }, { "id": 1 }] } }),
                vec![j!(0), j!(1)],
                btreeset!["a".to_string()],
            ),
        ];
        for (arg, eval, right, providers_expect) in checks.into_iter() {
            let mut providers = BTreeSet::new();
            let static_providers = BTreeMap::new();
            match JsonPath::new(vec![arg.into()], &mut providers, &static_providers).unwrap() {
                Either::A(j) => {
                    assert_eq!(providers, providers_expect);
                    let left: Vec<_> = j.evaluate_as_iter(&eval).collect();
                    assert_eq!(left, right)
                }
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn json_path_into_stream() {
        // constructor args, expect response, expect providers
        let checks = vec![
            (j!("a.b.c"), j!([1]), btreeset!["a".to_string()]),
            (j!("c.b.*.id"), j!([0, 1]), btreeset!["c".to_string()]),
        ];

        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!({ "b": {"c": 1 } })).into()),
                "c".to_string() => literals(vec!(j!({ "b": [{ "id": 0 }, { "id": 1 }] })).into()),
            );

            let providers = Arc::new(providers);
            let futures: Vec<_> = checks
                .into_iter()
                .map(|(arg, right, providers_expect)| {
                    let mut providers2 = BTreeSet::new();
                    let static_providers = BTreeMap::new();
                    match JsonPath::new(vec![arg.into()], &mut providers2, &static_providers)
                        .unwrap()
                    {
                        Either::A(j) => {
                            assert_eq!(providers2, providers_expect);
                            j.into_stream(&providers).into_future().map(move |(v, _)| {
                                assert_eq!(v.unwrap().0, right);
                            })
                        }
                        Either::B(_) => unreachable!(),
                    }
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn match_eval() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (
                vec![j!("bar").into(), j!("^b([a-z])r$").into()],
                None,
                j!({"0": "bar", "1": "a"}),
            ),
            (
                vec![
                    j!("bar").into(),
                    j!("^(?P<first>b)([a-z])(?P<last>r)$").into(),
                ],
                None,
                j!({"0": "bar", "first": "b", "2": "a", "last": "r"}),
            ),
            (
                vec!["foo".into(), j!("^b([a-z])r$").into()],
                Some(j!({ "foo": "bar" })),
                j!({"0": "bar", "1": "a"}),
            ),
            (
                vec!["foo".into(), j!("^(?P<first>b)([a-z])(?P<last>r)$").into()],
                Some(j!({ "foo": "bar" })),
                j!({"0": "bar", "first": "b", "2": "a", "last": "r"}),
            ),
        ];

        for (args, eval, right) in checks.into_iter() {
            match (eval, Match::new(args)) {
                (Some(eval), Ok(Either::A(e))) => {
                    let left = e.evaluate(&eval).unwrap();
                    assert_eq!(left, right)
                }
                (None, Ok(Either::B(left))) => assert_eq!(left, right),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn match_eval_iter() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (
                vec!["foo".into(), j!("^b([a-z])r$").into()],
                j!({ "foo": "bar" }),
                j!({"0": "bar", "1": "a"}),
            ),
            (
                vec!["foo".into(), j!("^(?P<first>b)([a-z])(?P<last>r)$").into()],
                j!({ "foo": "bar" }),
                j!({"0": "bar", "first": "b", "2": "a", "last": "r"}),
            ),
        ];

        for (args, eval, right) in checks.into_iter() {
            match Match::new(args) {
                Ok(Either::A(e)) => {
                    let left: Vec<_> = e.evaluate_as_iter(&eval).unwrap().collect();
                    assert_eq!(left, vec!(right))
                }
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn match_into_stream() {
        // constructor args, expect
        let checks = vec![
            (
                vec!["foo".into(), j!("^b([a-z])r$").into()],
                j!({"0": "bar", "1": "a"}),
            ),
            (
                vec!["foo".into(), j!("^(?P<first>b)([a-z])(?P<last>r)$").into()],
                j!({"0": "bar", "first": "b", "2": "a", "last": "r"}),
            ),
        ];

        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "foo".to_string() => literals(vec!(j!("bar")).into()),
            );

            let providers = Arc::new(providers);
            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right)| match Match::new(args) {
                    Ok(Either::A(m)) => {
                        m.into_stream(&providers).into_future().map(move |(v, _)| {
                            assert_eq!(v.unwrap().0, right);
                        })
                    }
                    _ => unreachable!(),
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn min_max_eval() {
        // min, constructor args, eval_arg, expect
        let checks = vec![
            (
                true,
                vec![j!(0.0).into(), j!(10).into(), j!(9).into()],
                None,
                j!(0.0),
            ),
            (
                false,
                vec![j!(0).into(), j!(10.0).into(), j!(9).into()],
                None,
                j!(10.0),
            ),
            (
                true,
                vec![j!(0).into(), j!(10).into(), j!("foo").into()],
                None,
                j!(0),
            ),
            (
                false,
                vec![j!(0).into(), j!(10).into(), j!("foo").into()],
                None,
                j!(10),
            ),
            (
                true,
                vec!["a".into(), j!(9).into(), "b".into()],
                Some(j!({ "a": 0, "b": 10 })),
                j!(0),
            ),
            (
                false,
                vec!["a".into(), j!(9).into(), "b".into()],
                Some(j!({ "a": 0, "b": 10 })),
                j!(10),
            ),
            (true, vec![j!("foo").into()], None, j!(null)),
            (false, vec![j!("foo").into()], None, j!(null)),
        ];

        for (min, args, eval, right) in checks.into_iter() {
            match (eval, MinMax::new(min, args).unwrap()) {
                (Some(eval), Either::A(m)) => {
                    let left = m.evaluate(&eval).unwrap();
                    assert_eq!(left, right)
                }
                (None, Either::B(left)) => assert_eq!(left, right),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn min_max_eval_iter() {
        // min, constructor args, eval_arg, expect
        let checks = vec![
            (
                true,
                vec!["a".into(), j!(9).into(), "b".into()],
                j!({ "a": 0.0, "b": 10 }),
                j!(0.0),
            ),
            (
                false,
                vec!["a".into(), j!(9).into(), "b".into()],
                j!({ "a": 0, "b": 10.0 }),
                j!(10.0),
            ),
        ];

        for (min, args, eval, right) in checks.into_iter() {
            if let Either::A(m) = MinMax::new(min, args).unwrap() {
                let left: Vec<_> = m.evaluate_as_iter(&eval).unwrap().collect();
                assert_eq!(left, vec!(right))
            } else {
                unreachable!();
            }
        }
    }

    #[test]
    fn min_max_into_stream() {
        // min, constructor args, expect
        let checks = vec![
            (true, vec!["a".into(), j!(9).into(), "b".into()], j!(0.0)),
            (false, vec!["a".into(), j!(9).into(), "b".into()], j!(10)),
        ];

        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(0.0)).into()),
                "b".to_string() => literals(vec!(j!(10)).into()),
            );

            let providers = Arc::new(providers);
            let futures: Vec<_> = checks
                .into_iter()
                .map(|(min, args, right)| {
                    if let Either::A(m) = MinMax::new(min, args).unwrap() {
                        m.into_stream(&providers).into_future().map(move |(v, _)| {
                            assert_eq!(v.unwrap().0, right);
                        })
                    } else {
                        unreachable!()
                    }
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn pad_eval() {
        // start_pad, constructor args, eval_arg, expect
        let checks = vec![
            (
                false,
                vec![j!("a").into(), j!(4).into(), j!("0").into()],
                None,
                j!("a000"),
            ),
            (
                false,
                vec![j!("a").into(), j!(6).into(), j!("0x").into()],
                None,
                j!("a0x0x0"),
            ),
            (
                true,
                vec![j!("a").into(), j!(4).into(), j!("0").into()],
                None,
                j!("000a"),
            ),
            (
                true,
                vec![j!("a").into(), j!(6).into(), j!("0x").into()],
                None,
                j!("0x0x0a"),
            ),
            (
                false,
                vec!["a".into(), j!(4).into(), j!("0").into()],
                Some(j!({ "a": "a" })),
                j!("a000"),
            ),
            (
                false,
                vec!["a".into(), j!(6).into(), j!("0x").into()],
                Some(j!({ "a": "a" })),
                j!("a0x0x0"),
            ),
            (
                true,
                vec!["a".into(), j!(4).into(), j!("0").into()],
                Some(j!({ "a": "a" })),
                j!("000a"),
            ),
            (
                true,
                vec!["a".into(), j!(6).into(), j!("0x").into()],
                Some(j!({ "a": "a" })),
                j!("0x0x0a"),
            ),
        ];

        for (start, args, eval, right) in checks.into_iter() {
            match (eval, Pad::new(start, args).unwrap()) {
                (Some(eval), Either::A(p)) => {
                    let left = p.evaluate(&eval).unwrap();
                    assert_eq!(left, right)
                }
                (None, Either::B(left)) => assert_eq!(left, right),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn pad_eval_iter() {
        // start_pad, constructor args, eval_arg, expect
        let checks = vec![
            (
                false,
                vec!["a".into(), j!(4).into(), j!("0").into()],
                j!({ "a": "a" }),
                j!("a000"),
            ),
            (
                false,
                vec!["a".into(), j!(6).into(), j!("0x").into()],
                j!({ "a": "a" }),
                j!("a0x0x0"),
            ),
            (
                true,
                vec!["a".into(), j!(4).into(), j!("0").into()],
                j!({ "a": "a" }),
                j!("000a"),
            ),
            (
                true,
                vec!["a".into(), j!(6).into(), j!("0x").into()],
                j!({ "a": "a" }),
                j!("0x0x0a"),
            ),
        ];

        for (start, args, eval, right) in checks.into_iter() {
            match Pad::new(start, args).unwrap() {
                Either::A(p) => {
                    let left: Vec<_> = p.evaluate_as_iter(&eval).unwrap().collect();
                    assert_eq!(left, vec!(right))
                }
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn pad_into_stream() {
        // start_pad, constructor args, expect
        let checks = vec![
            (
                false,
                vec!["a".into(), j!(4).into(), j!("0").into()],
                j!("a000"),
            ),
            (
                false,
                vec!["a".into(), j!(6).into(), j!("0x").into()],
                j!("a0x0x0"),
            ),
            (
                true,
                vec!["a".into(), j!(4).into(), j!("0").into()],
                j!("000a"),
            ),
            (
                true,
                vec!["a".into(), j!(6).into(), j!("0x").into()],
                j!("0x0x0a"),
            ),
        ];

        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!("a")).into()),
            );

            let providers = Arc::new(providers);
            let futures: Vec<_> = checks
                .into_iter()
                .map(
                    |(start, args, right)| match Pad::new(start, args).unwrap() {
                        Either::A(p) => {
                            p.into_stream(&providers).into_future().map(move |(v, _)| {
                                assert_eq!(v.unwrap().0, right);
                            })
                        }
                        _ => unreachable!(),
                    },
                )
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn random_eval() {
        let args = vec![(j!(1), j!(5)), (j!(-8), j!(25)), (j!(-8.5), j!(25))];

        for (first, second) in args.into_iter() {
            let r = Random::new(vec![first.clone().into(), second.clone().into()]).unwrap();
            let left = r.evaluate();
            if first.is_u64() && second.is_u64() {
                let left = left.as_u64().unwrap();
                let check = left >= first.as_u64().unwrap() && left < second.as_u64().unwrap();
                assert!(check);
            }
        }
    }

    #[test]
    fn random_eval_iter() {
        let args = vec![(j!(1), j!(5)), (j!(-8), j!(25)), (j!(-8.5), j!(25))];

        for (first, second) in args.into_iter() {
            let r = Random::new(vec![first.clone().into(), second.clone().into()]).unwrap();
            let mut left = r.evaluate_as_iter().collect::<Vec<_>>();
            assert_eq!(left.len(), 1);
            let left = left.pop().unwrap();
            if first.is_u64() && second.is_u64() {
                let left = left.as_u64().unwrap();
                let check = left >= first.as_u64().unwrap() && left < second.as_u64().unwrap();
                assert!(check);
            }
        }
    }

    #[test]
    fn random_into_stream() {
        let args = vec![(j!(1), j!(5)), (j!(-8), j!(25)), (j!(-8.5), j!(25))];

        current_thread::run(lazy(move || {
            let futures: Vec<_> = args
                .into_iter()
                .map(move |(first, second)| {
                    let r = Random::new(vec![first.clone().into(), second.clone().into()]).unwrap();
                    r.into_stream().into_future().map(move |(v, _)| {
                        let (left, _) = v.unwrap();
                        if first.is_u64() && second.is_u64() {
                            let left = left.as_u64().unwrap();
                            let check =
                                left >= first.as_u64().unwrap() && left < second.as_u64().unwrap();
                            assert!(check);
                        }
                    })
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }
    #[test]
    fn range_eval() {
        let data = j!({
            "a": 1,
            "b": 5
        });
        // constructor args, expect
        let checks = vec![
            (vec![j!(5).into(), j!(1).into()], j!([5, 4, 3, 2])),
            (vec![j!(1).into(), j!(5).into()], j!([1, 2, 3, 4])),
            (vec!["b".into(), "a".into()], j!([5, 4, 3, 2])),
            (vec!["a".into(), "b".into()], j!([1, 2, 3, 4])),
        ];

        for (args, right) in checks.into_iter() {
            let r = Range::new(args).unwrap();
            let left = r.evaluate(&data).unwrap();
            assert_eq!(left, right);
        }
    }

    #[test]
    fn range_eval_iter() {
        let data = j!({
            "a": 1,
            "b": 5
        });
        // constructor args, expect
        let checks = vec![
            (vec![j!(5).into(), j!(1).into()], j!([5, 4, 3, 2])),
            (vec![j!(1).into(), j!(5).into()], j!([1, 2, 3, 4])),
            (vec!["b".into(), "a".into()], j!([5, 4, 3, 2])),
            (vec!["a".into(), "b".into()], j!([1, 2, 3, 4])),
        ];

        for (args, right) in checks.into_iter() {
            let r = Range::new(args).unwrap();
            let left: Vec<_> = r.evaluate_as_iter(&data).unwrap().collect();
            let right = if let json::Value::Array(v) = right {
                v
            } else {
                unreachable!()
            };
            assert_eq!(left, right);
        }
    }

    #[test]
    fn range_into_stream() {
        // constructor args, expect
        let checks = vec![
            (vec![j!(5).into(), j!(1).into()], j!([5, 4, 3, 2])),
            (vec![j!(1).into(), j!(5).into()], j!([1, 2, 3, 4])),
            (vec!["b".into(), "a".into()], j!([5, 4, 3, 2])),
            (vec!["a".into(), "b".into()], j!([1, 2, 3, 4])),
        ];

        current_thread::run(lazy(move || {
            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(1)).into()),
                "b".to_string() => literals(vec!(j!(5)).into()),
            );

            let providers = Arc::new(providers);
            let futures: Vec<_> = checks
                .into_iter()
                .map(move |(args, right)| {
                    let r = Range::new(args).unwrap();
                    r.into_stream(&providers).into_future().map(move |(v, _)| {
                        assert_eq!(v.unwrap().0, right);
                    })
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }

    #[test]
    fn repeat_eval() {
        // constructor args, count
        let checks = vec![
            (vec![j!(5).into()], Either::A(5)),
            (vec![j!(1).into(), j!(5).into()], Either::B((1, 5))),
        ];

        for (args, count) in checks.into_iter() {
            let r = Repeat::new(args).unwrap();
            let v = if let json::Value::Array(v) = r.evaluate() {
                v
            } else {
                unreachable!();
            };
            assert!(v.iter().all(|v| *v == json::Value::Null));
            let len = v.len();
            match count {
                Either::A(n) => assert_eq!(len, n),
                Either::B((min, max)) => assert!(len >= min && len <= max),
            }
        }
    }

    #[test]
    fn repeat_eval_iter() {
        // constructor args, count
        let checks = vec![
            (vec![j!(5).into()], Either::A(5)),
            (vec![j!(1).into(), j!(5).into()], Either::B((1, 5))),
        ];

        for (args, count) in checks.into_iter() {
            let r = Repeat::new(args).unwrap();
            let v: Vec<_> = r.evaluate_as_iter().collect();
            assert!(v.iter().all(|v| *v == json::Value::Null));
            let len = v.len();
            match count {
                Either::A(n) => assert_eq!(len, n),
                Either::B((min, max)) => assert!(len >= min && len <= max),
            }
        }
    }

    #[test]
    fn repeat_into_stream() {
        // constructor args, count
        let checks = vec![
            (vec![j!(5).into()], Either::A(5)),
            (vec![j!(1).into(), j!(5).into()], Either::B((1, 5))),
        ];

        current_thread::run(lazy(move || {
            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, count)| {
                    let r = Repeat::new(args).unwrap();
                    r.into_stream().into_future().map(move |(v, _)| {
                        let (v, _) = v.unwrap();
                        let v = if let json::Value::Array(v) = v {
                            v
                        } else {
                            unreachable!();
                        };
                        assert!(v.iter().all(|v| *v == json::Value::Null));
                        let len = v.len();
                        match count {
                            Either::A(n) => assert_eq!(len, n),
                            Either::B((min, max)) => assert!(len >= min && len <= max),
                        }
                    })
                })
                .collect();
            join_all(futures).then(|_| Ok(()))
        }));
    }
}
