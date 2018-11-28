mod select_parser;

pub use self::select_parser::{
    REQUEST_STARTLINE,
    REQUEST_HEADERS,
    REQUEST_BODY,
    RESPONSE_STARTLINE,
    RESPONSE_HEADERS,
    RESPONSE_BODY,
    Select,
};

use crate::channel::Limit;
use crate::mod_interval::{LinearBuilder, HitsPer};
use crate::request::DeclareProvider;
use crate::template::json_value_to_string;

use hyper::Method;
use regex::Regex;
use serde::{
    de::{Error as DeError, Unexpected},
    Deserialize,
    Deserializer,
};
use serde_derive::Deserialize;
use serde_json as json;
use tuple_vec_map;

use std::{
    collections::BTreeMap,
    time::Duration,
};

#[serde(rename_all = "snake_case")]
#[derive(Deserialize)]
enum LoadPatternPreProcessed {
    Linear(LinearBuilderPreProcessed),
}

struct Percent(f64);

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct LinearBuilderPreProcessed {
    from: Option<Percent>,
    to: Percent,
    #[serde(deserialize_with = "deserialize_duration")]
    over: Duration,
}

pub enum LoadPattern {
    Linear(LinearBuilder),
}

impl LoadPattern {
    pub fn duration(&self) -> Duration {
        match self {
            LoadPattern::Linear(lb) => lb.duration
        }
    }
}

#[serde(rename_all = "snake_case")]
#[derive(Deserialize)]
pub enum Provider {
    File(FileProvider),
    Response(ResponseProvider),
    Static(json::Value),
    StaticList(Vec<json::Value>),
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct FileProvider {
    #[serde(default)]
    pub auto_return: Option<EndpointProvidesSendOptions>,
    #[serde(default = "Limit::auto")]
    // range 1-65535
    pub buffer: Limit,
    pub path: String,
    #[serde(default)]
    pub repeat: bool,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct ResponseProvider {
    #[serde(default)]
    pub auto_return: Option<EndpointProvidesSendOptions>,
    #[serde(default = "Limit::auto")]
    pub buffer: Limit,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct LoggerPreProcessed {
    #[serde(default)]
    select: Option<json::Value>,
    #[serde(default)]
    for_each: Vec<String>,
    #[serde(default, rename="where")]
    where_clause: Option<String>,
    to: String,
    #[serde(default)]
    pretty: bool,
    #[serde(default)]
    limit: Option<usize>,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct LogsPreProcessed {
    #[serde(default)]
    select: json::Value,
    #[serde(default)]
    for_each: Vec<String>,
    #[serde(default, rename="where")]
    where_clause: Option<String>,
}

pub struct Logger {
    pub select: Option<Select>,
    pub to: String,
    pub pretty: bool,
    pub limit: Option<usize>,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct Endpoint {
    #[serde(default)]
    pub declare: BTreeMap<String, DeclareProvider>,
    #[serde(default, with = "tuple_vec_map")]
    pub headers: Vec<(String, String)>,
    #[serde(default, deserialize_with = "deserialize_body")]
    pub body: Option<String>,
    #[serde(default, deserialize_with = "deserialize_option_vec_load_pattern")]
    pub load_pattern: Option<Vec<LoadPattern>>,
    #[serde(default, deserialize_with = "deserialize_method")]
    pub method: Method,
    #[serde(default)]
    pub peak_load: Option<HitsPer>,
    pub stats_id: Option<BTreeMap<String, String>>,
    pub url: String,
    #[serde(default, deserialize_with = "deserialize_providers")]
    pub provides: Vec<(String, Select)>,
    #[serde(default, deserialize_with = "deserialize_logs")]
    pub logs: Vec<(String, Select)>,
}

#[serde(rename_all = "snake_case")]
#[derive(Copy, Clone, Debug, Deserialize)]
pub enum EndpointProvidesSendOptions {
    Block,
    Force,
    IfNotFull,
}

impl EndpointProvidesSendOptions {
    pub fn is_if_not_full(self) -> bool {
        if let EndpointProvidesSendOptions::IfNotFull = self {
            true
        } else {
            false
        }
    }

    pub fn to_string(self) -> String {
        match self {
            EndpointProvidesSendOptions::Block => "block",
            EndpointProvidesSendOptions::Force => "force",
            EndpointProvidesSendOptions::IfNotFull => "if_not_full",
        }.to_string()
    }
}

impl Default for EndpointProvidesSendOptions {
    fn default() -> Self {
        EndpointProvidesSendOptions::Block
    }
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct EndpointProvidesPreProcessed {
    #[serde(default)]
    pub send: EndpointProvidesSendOptions,
    pub select: json::Value,
    #[serde(default)]
    pub for_each: Vec<String>,
    #[serde(default, rename="where")]
    pub where_clause: Option<String>,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct Config {
    pub endpoints: Vec<Endpoint>,
    #[serde(default, deserialize_with = "deserialize_option_vec_load_pattern")]
    pub load_pattern: Option<Vec<LoadPattern>>,
    #[serde(default, deserialize_with = "deserialize_providers")]
    pub providers: Vec<(String, Provider)>,
    #[serde(default, with = "tuple_vec_map")]
    pub loggers: Vec<(String, Logger)>,
}

impl<'de> Deserialize<'de> for Logger {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where D: Deserializer<'de>,
    {
        let lpp = LoggerPreProcessed::deserialize(deserializer)?;
        let select = if let Some(select) = lpp.select {
            Some(Select::new(EndpointProvidesPreProcessed {
                send: EndpointProvidesSendOptions::Block,
                select,
                for_each: lpp.for_each,
                where_clause: lpp.where_clause,
            }))
        } else {
            None
        };
        Ok(Logger {
            select,
            pretty: lpp.pretty,
            to: lpp.to,
            limit: lpp.limit,
        })
    }
}

impl<'de> Deserialize<'de> for Select {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where D: Deserializer<'de>,
    {
        let select = EndpointProvidesPreProcessed::deserialize(deserializer)?;
        Ok(Select::new(select))
    }
}

impl<'de> Deserialize<'de> for DeclareProvider {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        // `collect(3, foo)` OR `collect(3, 5, foo)`
        let collect_re = Regex::new(r"^collect\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?,\s*([^)\s]+?)\s*\)$").unwrap();
        let dp = match collect_re.captures(&s) {
            Some(captures) => {
                let min = captures.get(1).unwrap()
                    .as_str().parse().unwrap();
                let max = captures.get(2).and_then(|c| c.as_str().parse().ok());
                let ident = captures.get(3).unwrap()
                    .as_str().to_string();
                DeclareProvider::Collect(min, max, ident)
            },
            None => DeclareProvider::Alias(s),
        };
        Ok(dp)
    }
}
impl<'de> Deserialize<'de> for Percent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        let re = Regex::new(r"^(\d+(?:\.\d+)?)%$").unwrap();

        let captures = re.captures(&string)
            .ok_or_else(|| DeError::invalid_value(Unexpected::Str(&string), &"a percentage like `30%`"))?;

        Ok(Percent(captures.get(1).unwrap()
            .as_str().parse().unwrap()))
    }
}

impl<'de> Deserialize<'de> for HitsPer {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        let re = Regex::new(r"^(?i)(\d+)\s*hp([ms])$").unwrap();
        let captures = re.captures(&string).ok_or_else(|| DeError::invalid_value(Unexpected::Str(&string), &"example '150 hpm' or '300 hps'"))?;
        let n = captures.get(1)
            .unwrap().as_str()
            .parse().unwrap();
        if captures.get(2).unwrap().as_str()[0..1].eq_ignore_ascii_case("m") {
            Ok(HitsPer::Minute(n))
        } else {
            Ok(HitsPer::Second(n))
        }
    }
}

impl<'de> Deserialize<'de> for Limit {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        if string == "auto" {
            Ok(Limit::auto())
        } else {
            let n = string.parse::<usize>()
                .map_err(|_| DeError::invalid_value(Unexpected::Str(&string), &"a valid limit value"))?;
            Ok(Limit::Integer(n))
        }
    }
}

fn deserialize_body<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
    where D: Deserializer<'de>
{
    let res: Option<json::Value> = Option::deserialize(deserializer)?;
    Ok(res.as_ref().map(json_value_to_string))
}

fn deserialize_logs<'de, D> (deserializer: D) -> Result<Vec<(String, Select)>, D::Error>
    where D: Deserializer<'de>
{
    let lpp: Vec<(String, LogsPreProcessed)> = tuple_vec_map::deserialize(deserializer)?;
    let selects = lpp.into_iter()
        .map(|(s, lpp)| {
            let select = Select::new(EndpointProvidesPreProcessed {
                send: EndpointProvidesSendOptions::Block,
                select: lpp.select,
                for_each: lpp.for_each,
                where_clause: lpp.where_clause,
            });
            (s, select)
        })
        .collect();
    Ok(selects)
}

fn deserialize_providers<'de, D, T> (deserializer: D) -> Result<Vec<(String, T)>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
{
    let map: Vec<(String, T)> = tuple_vec_map::deserialize(deserializer)?;
    for (k, _) in &map {
        if k == "request" || k == "response" {
            return Err(DeError::invalid_value(Unexpected::Str(&k), &"Use of reserved provider name"))
        }
    }
    Ok(map)
}

fn deserialize_duration<'de, D> (deserializer: D) -> Result<Duration, D::Error>
    where D: Deserializer<'de>
{
    let string = String::deserialize(deserializer)?;
    let base_re = r"(?i)(\d+)\s*(h|m|s|hrs?|mins?|secs?|hours?|minutes?|seconds?)";
    let sanity_re = Regex::new(&format!(r"^(?:{}\s*)+$", base_re)).unwrap();
    if !sanity_re.is_match(&string) {
        return Err(DeError::invalid_value(Unexpected::Str(&string), &"example '15m' or '2 hours'"))
    }
    let mut total_secs = 0;
    let re = Regex::new(base_re).unwrap();
    for captures in re.captures_iter(&string) {
        let n: u64 = captures.get(1)
            .unwrap().as_str()
            .parse().unwrap();
        let unit = &captures.get(2).unwrap().as_str()[0..1];
        let secs = if unit.eq_ignore_ascii_case("h") {
            n * 60 * 60 // hours
        } else if unit.eq_ignore_ascii_case("m") {
            n * 60 // minutes
        } else {
            n // seconds
        };
        total_secs += secs;
    }
    Ok(Duration::from_secs(total_secs))
}

fn deserialize_method<'de, D>(deserializer: D) -> Result<Method, D::Error>
    where D: Deserializer<'de>
{
    let string = String::deserialize(deserializer)?;
    Method::from_bytes(&string.as_bytes())
        .map_err(|_| DeError::invalid_value(Unexpected::Str(&string), &"a valid HTTP method verb"))
}

fn deserialize_option_vec_load_pattern<'de, D>(deserializer: D) -> Result<Option<Vec<LoadPattern>>, D::Error>
    where D: Deserializer<'de>
{
    let ovlppp: Option<Vec<LoadPatternPreProcessed>> = Option::deserialize(deserializer)?;
    if let Some(vec) = ovlppp {
        let mut last_end = 0f64;
        let mut ret = Vec::new();
        for lppp in vec {
            match lppp {
                LoadPatternPreProcessed::Linear(lbpp) => {
                    let start = lbpp.from.map(|p| p.0 / 100f64).unwrap_or(last_end);
                    let end = lbpp.to.0 / 100f64;
                    last_end = end;
                    ret.push(LoadPattern::Linear(LinearBuilder::new(start, end, lbpp.over)));
                }
            }
        }
        return Ok(Some(ret))
    } else {
        return Ok(None)
    }
}
