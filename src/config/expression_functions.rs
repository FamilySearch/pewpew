use super::select_parser::{bool_value, f64_value, AutoReturn, Value, ValueOrExpression};
use crate::error::TestError;
use crate::providers;
use crate::util::{json_value_to_string, Either};

use futures::{future, stream, Future, IntoFuture, Stream};
use rand::distributions::{Distribution, Uniform};
use regex::Regex;
use serde_json as json;
use unicode_segmentation::UnicodeSegmentation;

use std::{
    borrow::Cow,
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
    env, fmt, iter,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug)]
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
                        Ok::<_, TestError>(Uniform::new_inclusive(second, max?))
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
        self.arg.evaluate(d).map(|v| v.into_owned())
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let n = if let Some(r) = self.random {
            r.sample(&mut rand::thread_rng())
        } else {
            self.min
        };
        let futures = (0..n).map(move |_| self.arg.evaluate_as_future(providers));
        stream::futures_ordered(futures)
            .fold(
                (Vec::new(), Vec::new()),
                |(mut jsons, mut outgoing), (json, outgoing2)| {
                    jsons.push(json);
                    outgoing.extend(outgoing2);
                    Ok::<_, TestError>((jsons, outgoing))
                },
            )
            // .fold(1, |_, _| Ok(1))
            .map(|(jsons, outgoing)| (jsons.into(), outgoing))
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

#[derive(Debug)]
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

    pub(super) fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let encoding = self.encoding;
        self.arg
            .evaluate_as_future(providers)
            .map(move |(d, returns)| (encoding.encode(&d).into(), returns))
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

    pub(super) fn evaluate_as_future(
        self,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let r = self.evaluate().map(|v| (v, Vec::new()));
        future::result(r)
    }
}

#[derive(Debug)]
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

    pub(super) fn evaluate_as_future(
        self: Arc<Self>,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let providers = providers.clone();
        self.first
            .evaluate_as_future(&providers)
            .and_then(move |(v, mut returns)| {
                let b = match bool_value(&v) {
                    Ok(b) => b,
                    Err(e) => return Either::B(Err(e).into_future()),
                };
                let f = if b {
                    self.second.evaluate_as_future(&providers)
                } else {
                    self.third.evaluate_as_future(&providers)
                };
                let a = f.map(move |(v, returns2)| {
                    returns.extend(returns2);
                    (v, returns)
                });
                Either::A(a)
            })
    }
}

#[derive(Debug)]
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
                let j = Join {
                    arg: one,
                    sep: two,
                    sep2: None,
                };
                if let ValueOrExpression::Value(Value::Json(json)) = &j.arg {
                    Ok(Either::B(j.evaluate_with_arg(json)))
                } else {
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
                let j = Join {
                    arg: one,
                    sep: two,
                    sep2: Some(three),
                };
                if let ValueOrExpression::Value(Value::Json(json)) = &j.arg {
                    Ok(Either::B(j.evaluate_with_arg(json)))
                } else {
                    Ok(Either::A(j))
                }
            }
            _ => Err(TestError::InvalidArguments("join".into())),
        }
    }

    fn evaluate_with_arg(&self, d: &json::Value) -> json::Value {
        match (d, &self.sep2) {
            (json::Value::Array(v), _) => v
                .iter()
                .map(|v| json_value_to_string(v).into_owned())
                .collect::<Vec<_>>()
                .as_slice()
                .join(&self.sep)
                .into(),
            (json::Value::Object(m), Some(sep2)) => m
                .iter()
                .map(|(k, v)| format!("{}{}{}", k, sep2, json_value_to_string(v)))
                .collect::<Vec<_>>()
                .as_slice()
                .join(&self.sep)
                .into(),
            _ => json_value_to_string(d).into_owned().into(),
        }
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        self.arg.evaluate(d).map(|d| self.evaluate_with_arg(&*d))
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn evaluate_as_future(
        self: Arc<Self>,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        self.arg
            .evaluate_as_future(providers)
            .map(move |(d, returns)| (self.evaluate_with_arg(&d), returns))
    }
}

pub(super) struct JsonPath {
    provider: String,
    selector: jsonpath::Selector,
}

impl fmt::Debug for JsonPath {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
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
                    selector: json_path,
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

    pub(super) fn evaluate_as_future(
        self: Arc<Self>,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let jp = self.clone();
        let jp2 = self.clone();
        providers
            .get(&self.provider)
            .map(move |provider| {
                let jp2 = jp.clone();
                let jp3 = jp.clone();
                let auto_return = provider.auto_return;
                let tx = provider.tx.clone();
                provider
                    .rx
                    .clone()
                    .into_future()
                    .map_err(move |_| TestError::ProviderEnded(Some(jp.provider.clone())))
                    .and_then(move |(v, _)| {
                        v.ok_or_else(|| TestError::ProviderEnded(Some(jp2.provider.clone())))
                    })
                    .map(move |v| {
                        let v = json::json!({ &*jp3.provider: v });
                        let result = jp3.evaluate(&v);
                        let outgoing = if let Some(ar) = auto_return {
                            vec![(ar, tx, vec![v.clone()])]
                        } else {
                            Vec::new()
                        };
                        (result, outgoing)
                    })
            })
            .ok_or_else(move || TestError::UnknownProvider(jp2.provider.clone()))
            .into_future()
            .flatten()
    }
}

#[derive(Debug)]
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
                let capture_names = regex
                    .capture_names()
                    .enumerate()
                    .map(|(i, n)| n.map(|s| s.into()).unwrap_or_else(|| i.to_string()))
                    .collect();
                let m = Match {
                    arg: args.into_iter().nth(0).expect("match should have two args"),
                    capture_names,
                    regex,
                };
                if let ValueOrExpression::Value(Value::Json(json)) = &m.arg {
                    Ok(Either::B(m.evaluate_with_arg(json)))
                } else {
                    Ok(Either::A(m))
                }
            }
            _ => Err(TestError::InvalidArguments("match".into())),
        }
    }

    fn evaluate_with_arg(&self, d: &json::Value) -> json::Value {
        let search_str = json_value_to_string(d);
        if let Some(captures) = self.regex.captures(&*search_str) {
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

    pub(super) fn evaluate(&self, d: &json::Value) -> Result<json::Value, TestError> {
        self.arg.evaluate(d).map(|d| self.evaluate_with_arg(&*d))
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn evaluate_as_future(
        self: Arc<Self>,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        self.arg
            .evaluate_as_future(providers)
            .map(move |(d, returns)| (self.evaluate_with_arg(&d), returns))
    }
}

#[derive(Debug)]
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
        let (v, count) = m.eval_iter(iter)?;
        if count == m.args.len() {
            Ok(Either::B(v.into_owned()))
        } else {
            Ok(Either::A(m))
        }
    }

    fn eval_iter<'a, I: Iterator<Item = Result<Cow<'a, json::Value>, TestError>>>(
        &self,
        mut iter: I,
    ) -> Result<(Cow<'a, json::Value>, usize), TestError> {
        iter.try_fold(
            (Cow::Owned(json::Value::Null), 0),
            |(left, count), right| {
                let right = right?;
                let l = f64_value(&*left);
                let r = f64_value(&*right);
                let v = match (l.partial_cmp(&r), self.min, l.is_finite()) {
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
        self.eval_iter(iter).map(|d| d.0.into_owned())
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        self.evaluate(d).map(iter::once)
    }

    pub(super) fn evaluate_as_future(
        self: Arc<Self>,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        let futures = self.args.iter().map(|fa| fa.evaluate_as_future(providers));
        stream::futures_unordered(futures)
            .collect()
            .and_then(move |values| {
                let iter = values.iter().map(|v| Ok(Cow::Borrowed(&v.0)));
                let v = self.eval_iter(iter)?.0.into_owned();
                let returns = values
                    .into_iter()
                    .fold(Vec::new(), |mut returns, (_, returns2)| {
                        returns.extend(returns2);
                        returns
                    });
                Ok((v, returns))
            })
    }
}

#[derive(Debug)]
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
                let p = Pad {
                    start,
                    arg: first,
                    min_length: second,
                    padding: third,
                };
                if let ValueOrExpression::Value(Value::Json(json)) = &p.arg {
                    Ok(Either::B(p.evaluate_with_arg(json)))
                } else {
                    Ok(Either::A(p))
                }
            }
            _ => Err(TestError::InvalidArguments("pad".into())),
        }
    }

    fn evaluate_with_arg(&self, d: &json::Value) -> json::Value {
        let string_to_pad = json_value_to_string(&d);
        let pad_str = self.padding.as_str();
        let str_len = string_to_pad.graphemes(true).count();
        let diff = self.min_length.saturating_sub(str_len);
        let mut pad_str: String = pad_str.graphemes(true).cycle().take(diff).collect();
        let output = if self.start {
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
        self.arg.evaluate(d).map(|d| self.evaluate_with_arg(&*d))
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> Result<impl Iterator<Item = json::Value> + Clone, TestError> {
        Ok(iter::once(self.evaluate(d)?))
    }

    pub(super) fn evaluate_as_future(
        self: Arc<Self>,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        self.arg
            .evaluate_as_future(providers)
            .map(move |(d, returns)| (self.evaluate_with_arg(&d), returns))
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
        i.map(|n| n.into())
    }
}

#[derive(Debug)]
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

    pub(super) fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        match self {
            Range::Args(first, second) => {
                let a = first
                    .evaluate_as_future(providers)
                    .join(second.evaluate_as_future(providers))
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
                Either::B(future::result(r))
            }
        }
    }
}

#[derive(Debug)]
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
                        Ok::<_, TestError>(Uniform::new_inclusive(min, max?))
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

    pub(super) fn evaluate_as_future(
        &self,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = TestError> {
        future::ok((self.evaluate(), Vec::new()))
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

    use futures::{
        future::{join_all, lazy},
        sync::oneshot,
    };
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
            ValueOrExpression::Value(Value::Path(Path {
                start: PathStart::Ident(s.into()),
                rest: vec![],
            }))
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
            let args = args.into_iter().map(|j| j.into()).collect();
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
            let args = args.into_iter().map(|j| j.into()).collect();
            let c = Collect::new(args).unwrap();
            let left: Vec<_> = c.evaluate_as_iter(&json::Value::Null).unwrap().collect();
            assert_eq!(left, right);
        }
    }

    #[test]
    fn collect_eval_future() {
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
            let (tx, rx) = oneshot::channel::<()>();
            let test_end = rx.shared();

            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(45)), None, test_end)
            );

            let providers = providers.into();

            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right, range)| {
                    let c = Collect::new(args).unwrap();
                    c.evaluate_as_future(&providers).map(move |(left, _)| {
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
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
    fn encode_eval_future() {
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
            let (tx, rx) = oneshot::channel::<()>();
            let test_end = rx.shared();

            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!("asd/jkl%")), None, test_end.clone()),
                "b".to_string() => literals(vec!(j!("asd\njkl#")), None, test_end.clone()),
                "c".to_string() => literals(vec!(j!("asd\njkl{")), None, test_end.clone()),
                "d".to_string() => literals(vec!(j!("asd jkl|")), None, test_end),
            );

            let providers = providers.into();

            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right)| match Encode::new(args).unwrap() {
                    Either::A(e) => e
                        .evaluate_as_future(&providers)
                        .map(move |(left, _)| assert_eq!(left, right)),
                    Either::B(_) => unreachable!(),
                })
                .collect();
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
    fn epoch_eval_future() {
        // constructor args
        let checks = vec![j!("s"), j!("ms"), j!("mu"), j!("ns")];

        current_thread::run(lazy(move || {
            let futures: Vec<_> = checks
                .into_iter()
                .map(|arg| {
                    let e = Epoch::new(vec![arg.into()]).unwrap();
                    e.evaluate_as_future().map(move |(left, _)| {
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
    fn if_eval_future() {
        // constructor args, expect
        let checks = vec![
            (vec!["a".into(), j!(1).into(), j!(2).into()], j!(1)),
            (vec!["b".into(), j!(1).into(), j!(2).into()], j!(2)),
        ];

        current_thread::run(lazy(move || {
            let (tx, rx) = oneshot::channel::<()>();
            let test_end = rx.shared();

            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(true)), None, test_end.clone()),
                "b".to_string() => literals(vec!(j!(false)), None, test_end.clone()),
            );

            let providers = providers.into();

            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right)| match If::new(args).unwrap() {
                    Either::A(e) => Arc::new(e)
                        .evaluate_as_future(&providers)
                        .map(move |(left, _)| assert_eq!(left, right)),
                    Either::B(_) => unreachable!(),
                })
                .collect();
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
    fn join_eval_future() {
        // constructor args, eval_arg, expect
        let checks = vec![
            (vec!["a".into(), j!("-").into()], j!("foo-bar-baz")),
            (vec!["b".into(), j!(",").into()], j!("1")),
            (vec!["c".into(), j!("&").into()], j!("foo&null&baz")),
        ];

        current_thread::run(lazy(move || {
            let (tx, rx) = oneshot::channel::<()>();
            let test_end = rx.shared();

            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(["foo", "bar", "baz"])), None, test_end.clone()),
                "b".to_string() => literals(vec!(j!(1)), None, test_end.clone()),
                "c".to_string() => literals(vec!(j!(["foo", null, "baz"])), None, test_end),
            );

            let providers = providers.into();
            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right)| match Join::new(args).unwrap() {
                    Either::A(j) => {
                        Arc::new(j)
                            .evaluate_as_future(&providers)
                            .map(move |(left, _)| {
                                assert_eq!(left, right);
                            })
                    }
                    Either::B(_) => unreachable!(),
                })
                .collect();
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
    fn json_path_eval_future() {
        // constructor args, expect response, expect providers
        let checks = vec![
            (j!("a.b.c"), j!([1]), btreeset!["a".to_string()]),
            (j!("c.b.*.id"), j!([0, 1]), btreeset!["c".to_string()]),
        ];

        current_thread::run(lazy(move || {
            let (tx, rx) = oneshot::channel::<()>();
            let test_end = rx.shared();

            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!({ "b": {"c": 1 } })), None, test_end.clone()),
                "c".to_string() => literals(vec!(j!({ "b": [{ "id": 0 }, { "id": 1 }] })), None, test_end),
            );

            let providers = providers.into();
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
                            Arc::new(j)
                                .evaluate_as_future(&providers)
                                .map(move |(left, _)| {
                                    assert_eq!(left, right);
                                })
                        }
                        Either::B(_) => unreachable!(),
                    }
                })
                .collect();
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
    fn match_eval_future() {
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
            let (tx, rx) = oneshot::channel::<()>();
            let test_end = rx.shared();

            let providers = btreemap!(
                "foo".to_string() => literals(vec!(j!("bar")), None, test_end.clone()),
            );

            let providers = providers.into();
            let futures: Vec<_> = checks
                .into_iter()
                .map(|(args, right)| match Match::new(args) {
                    Ok(Either::A(m)) => {
                        Arc::new(m)
                            .evaluate_as_future(&providers)
                            .map(move |(left, _)| {
                                assert_eq!(left, right);
                            })
                    }
                    _ => unreachable!(),
                })
                .collect();
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
    fn min_max_eval_future() {
        // min, constructor args, expect
        let checks = vec![
            (true, vec!["a".into(), j!(9).into(), "b".into()], j!(0.0)),
            (false, vec!["a".into(), j!(9).into(), "b".into()], j!(10)),
        ];

        current_thread::run(lazy(move || {
            let (tx, rx) = oneshot::channel::<()>();
            let test_end = rx.shared();

            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(0.0)), None, test_end.clone()),
                "b".to_string() => literals(vec!(j!(10)), None, test_end.clone()),
            );

            let providers = providers.into();
            let futures: Vec<_> = checks
                .into_iter()
                .map(|(min, args, right)| {
                    if let Either::A(m) = MinMax::new(min, args).unwrap() {
                        let m = Arc::new(m);
                        m.evaluate_as_future(&providers).map(move |(left, _)| {
                            assert_eq!(left, right);
                        })
                    } else {
                        unreachable!()
                    }
                })
                .collect();
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
    fn pad_eval_future() {
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
            let (tx, rx) = oneshot::channel::<()>();
            let test_end = rx.shared();

            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!("a")), None, test_end.clone()),
            );

            let providers = providers.into();
            let futures: Vec<_> = checks
                .into_iter()
                .map(
                    |(start, args, right)| match Pad::new(start, args).unwrap() {
                        Either::A(p) => {
                            Arc::new(p)
                                .evaluate_as_future(&providers)
                                .map(move |(left, _)| {
                                    assert_eq!(left, right);
                                })
                        }
                        _ => unreachable!(),
                    },
                )
                .collect();
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
    fn range_eval_future() {
        // constructor args, expect
        let checks = vec![
            (vec![j!(5).into(), j!(1).into()], j!([5, 4, 3, 2])),
            (vec![j!(1).into(), j!(5).into()], j!([1, 2, 3, 4])),
            (vec!["b".into(), "a".into()], j!([5, 4, 3, 2])),
            (vec!["a".into(), "b".into()], j!([1, 2, 3, 4])),
        ];

        current_thread::run(lazy(move || {
            let (tx, rx) = oneshot::channel::<()>();
            let test_end = rx.shared();

            let providers = btreemap!(
                "a".to_string() => literals(vec!(j!(1)), None, test_end.clone()),
                "b".to_string() => literals(vec!(j!(5)), None, test_end.clone()),
            );

            let providers = providers.into();
            let futures: Vec<_> = checks
                .into_iter()
                .map(move |(args, right)| {
                    let r = Range::new(args).unwrap();
                    r.evaluate_as_future(&providers).map(move |(left, _)| {
                        assert_eq!(left, right);
                    })
                })
                .collect();
            join_all(futures)
                .then(move |_| tx.send(()))
                .then(|_| Ok(()))
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
    fn repeat_eval_future() {
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
                    r.evaluate_as_future().map(move |(v, _)| {
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
