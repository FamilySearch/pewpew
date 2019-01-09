mod select_parser;

pub use self::select_parser::{
    AutoReturn, Select, ValueOrComplexExpression, REQUEST_BODY, REQUEST_HEADERS, REQUEST_STARTLINE,
    REQUEST_URL, RESPONSE_BODY, RESPONSE_HEADERS, RESPONSE_STARTLINE, STATS,
};

use crate::channel::Limit;
use crate::mod_interval::{HitsPer, LinearBuilder};
use crate::template::json_value_to_string;

use handlebars::Handlebars;
use hyper::Method;
use regex::Regex;
use serde::{
    de::{Error as DeError, Unexpected},
    Deserialize, Deserializer,
};
use serde_derive::Deserialize;
use serde_json as json;
use tuple_vec_map;

use std::{collections::BTreeMap, env, num::NonZeroU16, time::Duration};

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
            LoadPattern::Linear(lb) => lb.duration,
        }
    }
}

#[serde(rename_all = "snake_case")]
#[derive(Deserialize)]
pub enum Provider {
    File(FileProvider),
    #[serde(deserialize_with = "deserialize_environment")]
    Environment(json::Value),
    Range(RangeProvider),
    Response(ResponseProvider),
    Static(json::Value),
    StaticList(Vec<json::Value>),
}

pub struct RangeProvider(pub std::iter::StepBy<std::ops::RangeInclusive<i64>>);

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct RangeProviderPreProcessed {
    start: Option<i64>,
    end: Option<i64>,
    step: Option<NonZeroU16>,
}

#[serde(rename_all = "snake_case")]
#[derive(Deserialize)]
pub enum FileFormat {
    Csv,
    Json,
    Line,
}

impl Default for FileFormat {
    fn default() -> Self {
        FileFormat::Line
    }
}

#[serde(untagged)]
#[derive(Deserialize)]
pub enum CsvHeader {
    Bool(bool),
    String(String),
}

impl Default for CsvHeader {
    fn default() -> Self {
        CsvHeader::Bool(false)
    }
}

#[serde(deny_unknown_fields)]
#[derive(Default, Deserialize)]
pub struct CsvSettings {
    #[serde(default, deserialize_with = "deserialize_option_char")]
    pub comment: Option<u8>,
    #[serde(default, deserialize_with = "deserialize_option_char")]
    pub delimiter: Option<u8>,
    #[serde(default)]
    pub double_quote: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_option_char")]
    pub escape: Option<u8>,
    #[serde(default)]
    pub headers: CsvHeader,
    #[serde(default, deserialize_with = "deserialize_option_char")]
    pub terminator: Option<u8>,
    #[serde(default, deserialize_with = "deserialize_option_char")]
    pub quote: Option<u8>,
}

#[serde(deny_unknown_fields)]
#[derive(Default, Deserialize)]
pub struct FileProvider {
    #[serde(default)]
    pub csv: CsvSettings,
    #[serde(default)]
    pub auto_return: Option<EndpointProvidesSendOptions>,
    // range 1-65535
    #[serde(default)]
    pub buffer: Limit,
    #[serde(default)]
    pub format: FileFormat,
    #[serde(deserialize_with = "deserialize_path")]
    pub path: String,
    #[serde(default)]
    pub random: bool,
    #[serde(default)]
    pub repeat: bool,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct ResponseProvider {
    #[serde(default)]
    pub auto_return: Option<EndpointProvidesSendOptions>,
    #[serde(default)]
    pub buffer: Limit,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct LoggerPreProcessed {
    #[serde(default)]
    select: Option<json::Value>,
    #[serde(default)]
    for_each: Vec<String>,
    #[serde(default, rename = "where")]
    where_clause: Option<String>,
    #[serde(deserialize_with = "deserialize_path")]
    to: String,
    #[serde(default)]
    pretty: bool,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    kill: bool,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct LogsPreProcessed {
    #[serde(default)]
    select: json::Value,
    #[serde(default)]
    for_each: Vec<String>,
    #[serde(default, rename = "where")]
    where_clause: Option<String>,
}

pub struct Logger {
    pub select: Option<EndpointProvidesPreProcessed>,
    pub to: String,
    pub pretty: bool,
    pub limit: Option<usize>,
    pub kill: bool,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct Endpoint {
    #[serde(default)]
    pub declare: BTreeMap<String, String>,
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
    pub provides: Vec<(String, EndpointProvidesPreProcessed)>,
    #[serde(default, deserialize_with = "deserialize_logs")]
    pub logs: Vec<(String, EndpointProvidesPreProcessed)>,
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
        }
        .to_string()
    }
}

impl Default for EndpointProvidesSendOptions {
    fn default() -> Self {
        EndpointProvidesSendOptions::Block
    }
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct EndpointProvidesPreProcessed {
    #[serde(default)]
    pub send: EndpointProvidesSendOptions,
    pub select: json::Value,
    #[serde(default)]
    pub for_each: Vec<String>,
    #[serde(default, rename = "where")]
    pub where_clause: Option<String>,
}

#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Deserialize)]
pub enum SummaryOutputFormats {
    Json,
    Pretty,
}

impl SummaryOutputFormats {
    pub fn is_pretty(self) -> bool {
        match self {
            SummaryOutputFormats::Pretty => true,
            _ => false,
        }
    }
}

impl Default for SummaryOutputFormats {
    fn default() -> Self {
        SummaryOutputFormats::Pretty
    }
}

fn default_bucket_size() -> Duration {
    Duration::from_secs(60)
}

fn default_keepalive() -> Duration {
    Duration::from_secs(90)
}

fn default_request_timeout() -> Duration {
    Duration::from_secs(60)
}

fn default_auto_buffer_start_size() -> usize {
    5
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct ClientConfig {
    #[serde(default = "default_request_timeout")]
    pub request_timeout: Duration,
    #[serde(default, with = "tuple_vec_map")]
    pub headers: Vec<(String, String)>,
    #[serde(default = "default_keepalive")]
    pub keepalive: Duration,
}

impl Default for ClientConfig {
    fn default() -> Self {
        ClientConfig {
            request_timeout: default_request_timeout(),
            headers: Vec::new(),
            keepalive: default_keepalive(),
        }
    }
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct GeneralConfig {
    #[serde(default = "default_auto_buffer_start_size")]
    pub auto_buffer_start_size: usize,
    #[serde(
        default = "default_bucket_size",
        deserialize_with = "deserialize_duration"
    )]
    pub bucket_size: Duration,
    #[serde(default)]
    pub summary_output_format: SummaryOutputFormats,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        GeneralConfig {
            auto_buffer_start_size: default_auto_buffer_start_size(),
            bucket_size: default_bucket_size(),
            summary_output_format: SummaryOutputFormats::default(),
        }
    }
}

#[serde(deny_unknown_fields)]
#[derive(Default, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub client: ClientConfig,
    pub general: GeneralConfig,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct LoadTest {
    #[serde(default)]
    pub config: Config,
    pub endpoints: Vec<Endpoint>,
    #[serde(default, deserialize_with = "deserialize_option_vec_load_pattern")]
    pub load_pattern: Option<Vec<LoadPattern>>,
    #[serde(default, deserialize_with = "deserialize_providers")]
    pub providers: Vec<(String, Provider)>,
    #[serde(default, with = "tuple_vec_map")]
    pub loggers: Vec<(String, Logger)>,
}

impl<'de> Deserialize<'de> for RangeProvider {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let rppp = RangeProviderPreProcessed::deserialize(deserializer)?;
        let start = rppp.start.unwrap_or(0);
        let end = rppp.end.unwrap_or(i64::max_value());
        let step = usize::from(rppp.step.map(|n| n.get()).unwrap_or(1));
        Ok(RangeProvider((start..=end).step_by(step)))
    }
}

impl<'de> Deserialize<'de> for Logger {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let lpp = LoggerPreProcessed::deserialize(deserializer)?;
        let select = if let Some(select) = lpp.select {
            Some(EndpointProvidesPreProcessed {
                send: EndpointProvidesSendOptions::Block,
                select,
                for_each: lpp.for_each,
                where_clause: lpp.where_clause,
            })
        } else {
            None
        };
        Ok(Logger {
            select,
            pretty: lpp.pretty,
            to: lpp.to,
            limit: lpp.limit,
            kill: lpp.kill,
        })
    }
}

impl<'de> Deserialize<'de> for Percent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        let re = Regex::new(r"^(\d+(?:\.\d+)?)%$").unwrap();

        let captures = re.captures(&string).ok_or_else(|| {
            DeError::invalid_value(Unexpected::Str(&string), &"a percentage like `30%`")
        })?;

        Ok(Percent(captures.get(1).unwrap().as_str().parse().unwrap()))
    }
}

impl<'de> Deserialize<'de> for HitsPer {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        let re = Regex::new(r"^(?i)(\d+)\s*hp([ms])$").unwrap();
        let captures = re.captures(&string).ok_or_else(|| {
            DeError::invalid_value(Unexpected::Str(&string), &"example '150 hpm' or '300 hps'")
        })?;
        let n = captures.get(1).unwrap().as_str().parse().unwrap();
        if captures.get(2).unwrap().as_str()[0..1].eq_ignore_ascii_case("m") {
            Ok(HitsPer::Minute(n))
        } else {
            Ok(HitsPer::Second(n))
        }
    }
}

impl<'de> Deserialize<'de> for Limit {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let string = String::deserialize(deserializer)?;
        if string == "auto" {
            Ok(Limit::auto())
        } else {
            let n = string.parse::<usize>().map_err(|_| {
                DeError::invalid_value(Unexpected::Str(&string), &"a valid limit value")
            })?;
            Ok(Limit::Integer(n))
        }
    }
}

fn deserialize_path<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let template = String::deserialize(deserializer)?;
    let vars: BTreeMap<_, _> = std::env::vars_os()
        .map(|(k, v)| {
            (
                k.to_string_lossy().into_owned(),
                v.to_string_lossy().into_owned(),
            )
        })
        .collect();
    let handlebars = Handlebars::new();
    handlebars
        .render_template(&template, &vars)
        .map_err(DeError::custom)
}

fn deserialize_option_char<'de, D>(deserializer: D) -> Result<Option<u8>, D::Error>
where
    D: Deserializer<'de>,
{
    let c: Option<char> = Option::deserialize(deserializer)?;
    let c = if let Some(c) = c {
        if c.is_ascii() {
            let mut b = [0; 1];
            let _ = c.encode_utf8(&mut b);
            Some(b[0])
        } else {
            return Err(DeError::invalid_value(
                Unexpected::Char(c),
                &"a single-byte character",
            ));
        }
    } else {
        None
    };
    Ok(c)
}

fn deserialize_environment<'de, D>(deserializer: D) -> Result<json::Value, D::Error>
where
    D: Deserializer<'de>,
{
    let var = String::deserialize(deserializer)?;
    let value = env::var(var)
        .map_err(DeError::custom)
        .map(|s| json::from_str(&s).unwrap_or_else(|_e| json::Value::String(s)))?;
    Ok(value)
}

fn deserialize_body<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let res: Option<json::Value> = Option::deserialize(deserializer)?;
    Ok(res.as_ref().map(|v| json_value_to_string(v).into_owned()))
}

fn deserialize_logs<'de, D>(
    deserializer: D,
) -> Result<Vec<(String, EndpointProvidesPreProcessed)>, D::Error>
where
    D: Deserializer<'de>,
{
    let lpp: Vec<(String, LogsPreProcessed)> = tuple_vec_map::deserialize(deserializer)?;
    let selects = lpp
        .into_iter()
        .map(|(s, lpp)| {
            let eppp = EndpointProvidesPreProcessed {
                send: EndpointProvidesSendOptions::Block,
                select: lpp.select,
                for_each: lpp.for_each,
                where_clause: lpp.where_clause,
            };
            (s, eppp)
        })
        .collect();
    Ok(selects)
}

fn deserialize_providers<'de, D, T>(deserializer: D) -> Result<Vec<(String, T)>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    let map: Vec<(String, T)> = tuple_vec_map::deserialize(deserializer)?;
    for (k, _) in &map {
        if k == "request" || k == "response" || k == "for_each" || k == "stats" {
            return Err(DeError::invalid_value(
                Unexpected::Str(&k),
                &"Use of reserved provider name",
            ));
        }
    }
    Ok(map)
}

fn deserialize_duration<'de, D>(deserializer: D) -> Result<Duration, D::Error>
where
    D: Deserializer<'de>,
{
    let string = String::deserialize(deserializer)?;
    let base_re = r"(?i)(\d+)\s*(h|m|s|hrs?|mins?|secs?|hours?|minutes?|seconds?)";
    let sanity_re = Regex::new(&format!(r"^(?:{}\s*)+$", base_re)).unwrap();
    if !sanity_re.is_match(&string) {
        return Err(DeError::invalid_value(
            Unexpected::Str(&string),
            &"example '15m' or '2 hours'",
        ));
    }
    let mut total_secs = 0;
    let re = Regex::new(base_re).unwrap();
    for captures in re.captures_iter(&string) {
        let n: u64 = captures.get(1).unwrap().as_str().parse().unwrap();
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
where
    D: Deserializer<'de>,
{
    let string = String::deserialize(deserializer)?;
    Method::from_bytes(&string.as_bytes())
        .map_err(|_| DeError::invalid_value(Unexpected::Str(&string), &"a valid HTTP method verb"))
}

fn deserialize_option_vec_load_pattern<'de, D>(
    deserializer: D,
) -> Result<Option<Vec<LoadPattern>>, D::Error>
where
    D: Deserializer<'de>,
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
                    ret.push(LoadPattern::Linear(LinearBuilder::new(
                        start, end, lbpp.over,
                    )));
                }
            }
        }
        return Ok(Some(ret));
    } else {
        return Ok(None);
    }
}
