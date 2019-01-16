use super::select_parser::{AutoReturn, DeclareError, FunctionArg, Value};
use crate::providers;
use crate::util::{json_value_to_string, parse_provider_name, Either};

use futures::{future, stream, Future, IntoFuture, Stream};
use rand::distributions::{Distribution, Uniform};
use regex::Regex;
use serde_json as json;
use unicode_segmentation::UnicodeSegmentation;

use std::{
    collections::{BTreeMap, BTreeSet},
    env, iter,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) struct Collect {
    arg: FunctionArg,
    min: u64,
    random: Option<Uniform<u64>>,
}

impl Collect {
    pub(super) fn new(mut args: Vec<FunctionArg>) -> Self {
        let as_u64 = |fa| match fa {
            FunctionArg::Value(Value::Json(json::Value::Number(ref n))) if n.is_u64() => {
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
                Collect {
                    arg: first,
                    min: second,
                    random: third,
                }
            }
            _ => panic!("invalid arguments for repeat"),
        }
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> json::Value {
        self.arg.evaluate(d).into_owned()
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        iter::once(self.evaluate(d))
    }

    pub(super) fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
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
                    Ok((jsons, outgoing))
                },
            )
            .map(|(jsons, outgoing)| (jsons.into(), outgoing))
    }
}

#[derive(Copy, Clone)]
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
}

impl From<&str> for Encoding {
    fn from(s: &str) -> Encoding {
        match s {
            "percent-simple" => Encoding::PercentSimple,
            "percent-query" => Encoding::PercentQuery,
            "percent" => Encoding::Percent,
            "percent-path" => Encoding::PercentPath,
            "percent-userinfo" => Encoding::PercentUserinfo,
            _ => panic!("unknown encoding `{}`", s),
        }
    }
}

pub(super) struct Encode {
    arg: FunctionArg,
    encoding: Encoding,
}

impl Encode {
    pub(super) fn new(mut args: Vec<FunctionArg>) -> Either<Self, json::Value> {
        match args.as_slice() {
            [_, FunctionArg::Value(Value::Json(json::Value::String(encoding)))] => {
                let encoding = encoding.as_str().into();
                let e = Encode {
                    arg: args.remove(0),
                    encoding,
                };
                if let FunctionArg::Value(Value::Json(json)) = &e.arg {
                    Either::B(e.evaluate_with_arg(json))
                } else {
                    Either::A(e)
                }
            }
            _ => panic!("invalid arguments for encode"),
        }
    }

    fn evaluate_with_arg(&self, d: &json::Value) -> json::Value {
        self.encoding.encode(d).into()
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> json::Value {
        let v = self.arg.evaluate(d);
        self.evaluate_with_arg(&*v)
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        iter::once(self.evaluate(d))
    }

    pub(super) fn evaluate_as_future(
        &self,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        let encoding = self.encoding;
        self.arg
            .evaluate_as_future(providers)
            .map(move |(d, returns)| (encoding.encode(&d).into(), returns))
    }
}

#[derive(Copy, Clone)]
pub(super) enum Epoch {
    Seconds,
    Milliseconds,
    Microseconds,
    Nanoseconds,
}

impl Epoch {
    pub(super) fn new(args: Vec<FunctionArg>) -> Self {
        match args.as_slice() {
            [FunctionArg::Value(Value::Json(json::Value::String(unit)))] => unit.as_str().into(),
            _ => panic!("invalid arguments for epoch"),
        }
    }

    pub(super) fn evaluate(self) -> json::Value {
        let start = SystemTime::now();
        let since_the_epoch = start
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards");
        let n = match self {
            Epoch::Seconds => u128::from(since_the_epoch.as_secs()),
            Epoch::Milliseconds => since_the_epoch.as_millis(),
            Epoch::Microseconds => since_the_epoch.as_micros(),
            Epoch::Nanoseconds => since_the_epoch.as_nanos(),
        };
        n.to_string().into()
    }

    pub(super) fn evaluate_as_iter(self) -> impl Iterator<Item = json::Value> + Clone {
        iter::once(self.evaluate())
    }

    pub(super) fn evaluate_as_future(
        self,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        future::ok((self.evaluate(), Vec::new()))
    }
}

impl From<&str> for Epoch {
    fn from(s: &str) -> Epoch {
        match s {
            "s" => Epoch::Seconds,
            "ms" => Epoch::Milliseconds,
            "mu" => Epoch::Microseconds,
            "ns" => Epoch::Nanoseconds,
            _ => panic!("unknown epoch format `{}`", s),
        }
    }
}

pub(super) struct Join {
    arg: FunctionArg,
    sep: String,
}

impl Join {
    pub(super) fn new(mut args: Vec<FunctionArg>) -> Either<Self, json::Value> {
        let into_string = |fa| {
            if let FunctionArg::Value(Value::Json(json::Value::String(s))) = fa {
                s
            } else {
                panic!("invalid arguments for repeat")
            }
        };
        match args.as_slice() {
            [_, FunctionArg::Value(Value::Json(json::Value::String(_)))] => {
                let two = into_string(args.pop().unwrap());
                let one = args.pop().unwrap();
                let j = Join { arg: one, sep: two };
                if let FunctionArg::Value(Value::Json(json)) = &j.arg {
                    Either::B(j.evaluate_with_arg(json))
                } else {
                    Either::A(j)
                }
            }
            _ => panic!("invalid arguments for join"),
        }
    }

    fn evaluate_with_arg(&self, d: &json::Value) -> json::Value {
        match d {
            json::Value::Array(v) => v
                .iter()
                .map(|v| json_value_to_string(v).into_owned())
                .collect::<Vec<_>>()
                .as_slice()
                .join(&self.sep)
                .into(),
            _ => json_value_to_string(d).into_owned().into(),
        }
    }

    pub(super) fn evaluate(&self, d: &json::Value) -> json::Value {
        let d = self.arg.evaluate(d);
        self.evaluate_with_arg(&*d)
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        iter::once(self.evaluate(d))
    }

    pub(super) fn evaluate_as_future(
        self: Arc<Self>,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        self.arg
            .evaluate_as_future(providers)
            .map(move |(d, returns)| (self.evaluate_with_arg(&d), returns))
    }
}

pub(super) struct JsonPath {
    provider: String,
    selector: jsonpath::Selector,
}

impl JsonPath {
    pub(super) fn new(
        args: Vec<FunctionArg>,
        providers: &mut BTreeSet<String>,
        static_providers: &BTreeMap<String, json::Value>,
    ) -> Either<Self, json::Value> {
        match args.as_slice() {
            [FunctionArg::Value(Value::Json(json::Value::String(json_path)))] => {
                let provider = parse_provider_name(&*json_path);
                // jsonpath requires the query to start with `$.`, so add it in
                let json_path = if json_path.starts_with('[') {
                    format!("${}", json_path)
                } else {
                    format!("$.{}", json_path)
                };
                let json_path = jsonpath::Selector::new(&*json_path)
                    .unwrap_or_else(|e| panic!("invalid json_path query, {}\n{:?}", json_path, e));
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
                    Either::B(v)
                } else {
                    providers.insert(provider.into());
                    Either::A(j)
                }
            }
            _ => panic!("invalid arguments for json_path",),
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
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
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
                    .map_err(move |_| DeclareError::ProviderEnded(jp.provider.clone()))
                    .and_then(move |(v, _)| {
                        v.ok_or_else(|| DeclareError::ProviderEnded(jp2.provider.clone()))
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
            .ok_or_else(move || DeclareError::UnknownProvider(jp2.provider.clone()))
            .into_future()
            .flatten()
    }
}

pub(super) struct Match {
    arg: FunctionArg,
    capture_names: Vec<String>,
    regex: Regex,
}

impl Match {
    pub(super) fn new(args: Vec<FunctionArg>) -> Result<Either<Self, json::Value>, regex::Error> {
        match args.as_slice() {
            [_, FunctionArg::Value(Value::Json(json::Value::String(regex_str)))] => {
                let regex = Regex::new(regex_str)?;
                let capture_names = regex
                    .capture_names()
                    .enumerate()
                    .map(|(i, n)| n.map(|s| s.into()).unwrap_or_else(|| i.to_string()))
                    .collect();
                let m = Match {
                    arg: args.into_iter().nth(0).unwrap(),
                    capture_names,
                    regex,
                };
                if let FunctionArg::Value(Value::Json(json)) = &m.arg {
                    Ok(Either::B(m.evaluate_with_arg(json)))
                } else {
                    Ok(Either::A(m))
                }
            }
            _ => panic!("invalid arguments for match"),
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

    pub(super) fn evaluate(&self, d: &json::Value) -> json::Value {
        let d = self.arg.evaluate(d);
        self.evaluate_with_arg(&*d)
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        iter::once(self.evaluate(d))
    }

    pub(super) fn evaluate_as_future(
        self: Arc<Self>,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        self.arg
            .evaluate_as_future(providers)
            .map(move |(d, returns)| (self.evaluate_with_arg(&d), returns))
    }
}

pub(super) struct Pad {
    start: bool,
    arg: FunctionArg,
    min_length: usize,
    padding: String,
}

impl Pad {
    pub(super) fn new(start: bool, mut args: Vec<FunctionArg>) -> Either<Self, json::Value> {
        let as_usize = |fa| match fa {
            FunctionArg::Value(Value::Json(json::Value::Number(ref n))) if n.is_u64() => {
                n.as_u64().unwrap() as usize
            }
            _ => panic!("invalid arguments for repeat"),
        };
        let into_string = |fa| {
            if let FunctionArg::Value(Value::Json(json::Value::String(s))) = fa {
                s
            } else {
                panic!("invalid arguments for repeat")
            }
        };
        match args.as_slice() {
            [_, FunctionArg::Value(Value::Json(json::Value::Number(_))), FunctionArg::Value(Value::Json(json::Value::String(_)))] =>
            {
                let third = into_string(args.pop().unwrap());
                let second = as_usize(args.pop().unwrap());
                let first = args.pop().unwrap();
                let p = Pad {
                    start,
                    arg: first,
                    min_length: second,
                    padding: third,
                };
                if let FunctionArg::Value(Value::Json(json)) = &p.arg {
                    Either::B(p.evaluate_with_arg(json))
                } else {
                    Either::A(p)
                }
            }
            _ => panic!("invalid arguments for pad"),
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

    pub(super) fn evaluate(&self, d: &json::Value) -> json::Value {
        let d = self.arg.evaluate(d);
        self.evaluate_with_arg(&*d)
    }

    pub(super) fn evaluate_as_iter(
        &self,
        d: &json::Value,
    ) -> impl Iterator<Item = json::Value> + Clone {
        iter::once(self.evaluate(d))
    }

    pub(super) fn evaluate_as_future(
        self: Arc<Self>,
        providers: &Arc<BTreeMap<String, providers::Kind>>,
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        self.arg
            .evaluate_as_future(providers)
            .map(move |(d, returns)| (self.evaluate_with_arg(&d), returns))
    }
}

pub(super) struct Repeat {
    min: u64,
    random: Option<Uniform<u64>>,
}

impl Repeat {
    pub(super) fn new(mut args: Vec<FunctionArg>) -> Self {
        let as_u64 = |fa| match fa {
            FunctionArg::Value(Value::Json(json::Value::Number(ref n))) if n.is_u64() => {
                n.as_u64().unwrap()
            }
            _ => panic!("invalid arguments for repeat"),
        };
        match args.len() {
            1 | 2 => {
                let min = as_u64(args.remove(0));
                let random = args.pop().map(|fa| {
                    let max = as_u64(fa);
                    Uniform::new_inclusive(min, max)
                });
                Repeat { min, random }
            }
            _ => panic!("invalid arguments for repeat"),
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
    ) -> impl Future<Item = (json::Value, Vec<AutoReturn>), Error = DeclareError> {
        future::ok((self.evaluate(), Vec::new()))
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

    impl From<json::Value> for FunctionArg {
        fn from(j: json::Value) -> Self {
            FunctionArg::Value(Value::Json(j))
        }
    }

    impl From<&str> for FunctionArg {
        fn from(s: &str) -> Self {
            FunctionArg::Value(Value::Path(
                false,
                Path {
                    start: PathStart::Ident(s.into()),
                    rest: vec![],
                },
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
            let args = args.into_iter().map(|j| j.into()).collect();
            let c = Collect::new(args);
            let left = c.evaluate(&json::Value::Null);
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
            let c = Collect::new(args);
            let left: Vec<_> = c.evaluate_as_iter(&json::Value::Null).collect();
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
                    let c = Collect::new(args);
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
            match (eval, Encode::new(args)) {
                (Some(eval), Either::A(e)) => {
                    let left = e.evaluate(&eval);
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
            match Encode::new(args) {
                Either::A(e) => {
                    let left: Vec<_> = e.evaluate_as_iter(&eval).collect();
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
                .map(|(args, right)| match Encode::new(args) {
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
            let e = Epoch::new(vec![arg.into()]);
            let left = json_value_into_string(e.evaluate())
                .parse::<u128>()
                .unwrap();
            let epoch = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("Time went backwards");
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
            let e = Epoch::new(vec![arg.into()]);
            let mut left: Vec<_> = e.evaluate_as_iter().collect();
            assert_eq!(left.len(), 1);
            let left = json_value_into_string(left.pop().unwrap())
                .parse::<u128>()
                .unwrap();
            let epoch = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("Time went backwards");
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
                    let e = Epoch::new(vec![arg.into()]);
                    e.evaluate_as_future().map(move |(left, _)| {
                        let epoch = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .expect("Time went backwards");
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
        ];

        for (args, eval, right) in checks.into_iter() {
            match (eval, Join::new(args)) {
                (Some(eval), Either::A(e)) => {
                    let left = e.evaluate(&eval);
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
            match Join::new(args) {
                Either::A(e) => {
                    let left: Vec<_> = e.evaluate_as_iter(&eval).collect();
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
                .map(|(args, right)| match Join::new(args) {
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
                    JsonPath::new(vec![arg.clone().into()], &mut providers, &static_providers),
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
            match JsonPath::new(vec![arg.into()], &mut providers, &static_providers) {
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
                    match JsonPath::new(vec![arg.into()], &mut providers2, &static_providers) {
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
                    let left = e.evaluate(&eval);
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
                    let left: Vec<_> = e.evaluate_as_iter(&eval).collect();
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
            match (eval, Pad::new(start, args)) {
                (Some(eval), Either::A(p)) => {
                    let left = p.evaluate(&eval);
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
            match Pad::new(start, args) {
                Either::A(p) => {
                    let left: Vec<_> = p.evaluate_as_iter(&eval).collect();
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
                .map(|(start, args, right)| match Pad::new(start, args) {
                    Either::A(p) => {
                        Arc::new(p)
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
    fn repeat_eval() {
        // constructor args, count
        let checks = vec![
            (vec![j!(5).into()], Either::A(5)),
            (vec![j!(1).into(), j!(5).into()], Either::B((1, 5))),
        ];

        for (args, count) in checks.into_iter() {
            let r = Repeat::new(args);
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
            let r = Repeat::new(args);
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
                    let r = Repeat::new(args);
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
