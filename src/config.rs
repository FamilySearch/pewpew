mod expression_functions;
mod select_parser;

pub use self::select_parser::{
    AutoReturn, AutoReturnFuture, Rule as ParserRule, Select, Template, ValueOrExpression,
    REQUEST_BODY, REQUEST_HEADERS, REQUEST_STARTLINE, REQUEST_URL, RESPONSE_BODY, RESPONSE_HEADERS,
    RESPONSE_STARTLINE, STATS,
};

use crate::error::TestError;

use channel::Limit;
use ether::{Either, Either3};
use hyper::Method;
use mod_interval::{HitsPer, LinearBuilder, LinearScaling, ModInterval};
use rand::{
    distributions::{Distribution, Uniform},
    Rng,
};
use regex::Regex;
use serde::{
    de::{Error as DeError, Unexpected},
    Deserialize, Deserializer,
};
use serde_json as json;
use tuple_vec_map;

use std::{
    collections::BTreeMap,
    iter,
    num::{NonZeroU16, NonZeroUsize},
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

#[derive(Clone)]
pub enum LoadPattern {
    Linear(LinearBuilder),
}

impl LoadPattern {
    pub fn build<E>(self, peak_load: &HitsPer) -> ModInterval<LinearScaling, E> {
        match self {
            LoadPattern::Linear(lb) => lb.build(peak_load),
        }
    }

    pub fn duration(&self) -> Duration {
        match self {
            LoadPattern::Linear(lb) => lb.duration(),
        }
    }
}

fn default_true() -> bool {
    true
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct ExplicitStaticList {
    #[serde(default)]
    pub random: bool,
    #[serde(default = "default_true")]
    pub repeat: bool,
    pub values: Vec<json::Value>,
}

#[serde(untagged)]
#[derive(Deserialize)]
pub enum StaticList {
    Explicit(ExplicitStaticList),
    Implicit(Vec<json::Value>),
}

impl From<Vec<json::Value>> for StaticList {
    fn from(v: Vec<json::Value>) -> Self {
        StaticList::Implicit(v)
    }
}

impl From<ExplicitStaticList> for StaticList {
    fn from(e: ExplicitStaticList) -> Self {
        StaticList::Explicit(e)
    }
}

impl IntoIterator for StaticList {
    type Item = json::Value;
    type IntoIter = Either3<
        StaticListRepeatRandomIterator,
        std::vec::IntoIter<json::Value>,
        std::iter::Cycle<std::vec::IntoIter<json::Value>>,
    >;

    fn into_iter(self) -> Self::IntoIter {
        match self {
            StaticList::Explicit(mut e) => match (e.repeat, e.random) {
                (true, true) => {
                    let a = StaticListRepeatRandomIterator {
                        random: Uniform::new(0, e.values.len()),
                        values: e.values,
                    };
                    Either3::A(a)
                }
                (false, false) => Either3::B(e.values.into_iter()),
                (false, true) => {
                    let mut rng = rand::thread_rng();
                    e.values.sort_unstable_by_key(|_| rng.gen::<usize>());
                    Either3::B(e.values.into_iter())
                }
                (true, false) => Either3::C(e.values.into_iter().cycle()),
            },
            StaticList::Implicit(v) => Either3::C(v.into_iter().cycle()),
        }
    }
}

pub struct StaticListRepeatRandomIterator {
    values: Vec<json::Value>,
    random: Uniform<usize>,
}

impl Iterator for StaticListRepeatRandomIterator {
    type Item = json::Value;

    fn next(&mut self) -> Option<Self::Item> {
        let pos_index = self.random.sample(&mut rand::thread_rng());
        self.values.get(pos_index).cloned()
    }
}

#[serde(rename_all = "snake_case")]
#[derive(Deserialize)]
pub enum Provider {
    File(FileProvider),
    Range(RangeProvider),
    Response(ResponseProvider),
    #[serde(deserialize_with = "deserialize_static_json")]
    Static(json::Value),
    StaticList(StaticList),
}

type RangeProviderIteratorA = iter::StepBy<std::ops::RangeInclusive<i64>>;

pub struct RangeProvider(pub Either<RangeProviderIteratorA, iter::Cycle<RangeProviderIteratorA>>);

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct RangeProviderPreProcessed {
    start: Option<i64>,
    end: Option<i64>,
    step: Option<NonZeroU16>,
    #[serde(default)]
    repeat: bool,
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
    pub alias: Option<String>,
    #[serde(default)]
    pub declare: BTreeMap<String, String>,
    #[serde(default, with = "tuple_vec_map")]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<Body>,
    #[serde(default, deserialize_with = "deserialize_option_vec_load_pattern")]
    pub load_pattern: Option<LoadPattern>,
    #[serde(default, deserialize_with = "deserialize_method")]
    pub method: Method,
    #[serde(default)]
    pub on_demand: bool,
    #[serde(default, deserialize_with = "deserialize_options_hits_per")]
    pub peak_load: Option<HitsPer>,
    pub stats_id: Option<BTreeMap<String, String>>,
    pub url: String,
    #[serde(default, deserialize_with = "deserialize_providers")]
    pub provides: Vec<(String, EndpointProvidesPreProcessed)>,
    #[serde(default, deserialize_with = "deserialize_logs")]
    pub logs: Vec<(String, EndpointProvidesPreProcessed)>,
    #[serde(default)]
    pub max_parallel_requests: Option<NonZeroUsize>,
    #[serde(default)]
    pub no_auto_returns: bool,
}

pub enum Body {
    String(String),
    File(String),
    Multipart(Vec<(String, BodyMultipartPiece)>),
}

pub struct BodyMultipartPiece {
    pub headers: Vec<(String, String)>,
    pub body: BodyMultipartPieceBody,
}

pub enum BodyMultipartPieceBody {
    String(String),
    File(String),
}

#[serde(untagged)]
#[derive(Deserialize)]
enum BodyMultipartPieceBodyHelper {
    String(String),
    File(BodyFileHelper),
}

#[serde(untagged)]
#[derive(Deserialize)]
enum BodyHelper {
    String(String),
    File(BodyFileHelper),
    Multipart(BodyMultipartHelper),
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct BodyMultipartPieceHelper {
    #[serde(default, with = "tuple_vec_map")]
    pub headers: Vec<(String, String)>,
    pub body: BodyMultipartPieceBodyHelper,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct BodyMultipartHelper {
    #[serde(with = "tuple_vec_map")]
    multipart: Vec<(String, BodyMultipartPieceHelper)>,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct BodyFileHelper {
    file: String,
}

#[serde(rename_all = "snake_case")]
#[derive(Copy, Clone, Debug, Deserialize)]
pub enum EndpointProvidesSendOptions {
    Block,
    Force,
    IfNotFull,
}

impl EndpointProvidesSendOptions {
    pub fn is_block(self) -> bool {
        if let EndpointProvidesSendOptions::Block = self {
            true
        } else {
            false
        }
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
    pub send: Option<EndpointProvidesSendOptions>,
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
#[derive(Clone, Deserialize)]
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
#[derive(Clone, Deserialize)]
pub struct GeneralConfig {
    #[serde(default = "default_auto_buffer_start_size")]
    pub auto_buffer_start_size: usize,
    #[serde(
        default = "default_bucket_size",
        deserialize_with = "deserialize_duration"
    )]
    pub bucket_size: Duration,
    #[serde(default, deserialize_with = "deserialize_duration_option")]
    pub log_provider_stats: Option<Duration>,
    #[serde(default)]
    pub summary_output_format: SummaryOutputFormats,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        GeneralConfig {
            auto_buffer_start_size: default_auto_buffer_start_size(),
            bucket_size: default_bucket_size(),
            log_provider_stats: None,
            summary_output_format: SummaryOutputFormats::default(),
        }
    }
}

#[serde(deny_unknown_fields)]
#[derive(Clone, Default, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub client: ClientConfig,
    #[serde(default)]
    pub general: GeneralConfig,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
pub struct LoadTest {
    #[serde(default)]
    pub config: Config,
    pub endpoints: Vec<Endpoint>,
    #[serde(default, deserialize_with = "deserialize_option_vec_load_pattern")]
    pub load_pattern: Option<LoadPattern>,
    #[serde(default, deserialize_with = "deserialize_providers")]
    pub providers: Vec<(String, Provider)>,
    #[serde(default, with = "tuple_vec_map")]
    pub loggers: Vec<(String, Logger)>,
}

impl<'de> Deserialize<'de> for Body {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let bh = BodyHelper::deserialize(deserializer)?;
        let body = match bh {
            BodyHelper::String(s) => Body::String(s),
            BodyHelper::File(fh) => Body::File(fh.file),
            BodyHelper::Multipart(mp) => {
                let inner = mp
                    .multipart
                    .into_iter()
                    .map(|(k, v)| {
                        let body = match v.body {
                            BodyMultipartPieceBodyHelper::String(s) => {
                                BodyMultipartPieceBody::String(s)
                            }
                            BodyMultipartPieceBodyHelper::File(f) => {
                                BodyMultipartPieceBody::File(f.file)
                            }
                        };
                        let v = BodyMultipartPiece {
                            headers: v.headers,
                            body,
                        };
                        (k, v)
                    })
                    .collect();
                Body::Multipart(inner)
            }
        };
        Ok(body)
    }
}

impl<'de> Deserialize<'de> for RangeProvider {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let rppp = RangeProviderPreProcessed::deserialize(deserializer)?;
        let start = rppp.start.unwrap_or(0);
        let end = rppp.end.unwrap_or(i64::max_value());
        let step = usize::from(rppp.step.map(NonZeroU16::get).unwrap_or(1));
        let iter = (start..=end).step_by(step);
        let iter = if rppp.repeat {
            Either::B(iter.cycle())
        } else {
            Either::A(iter)
        };
        Ok(RangeProvider(iter))
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
                send: Some(EndpointProvidesSendOptions::Block),
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
        let sp = BTreeMap::new();
        let string = Template::new(&string, &sp)
            .map_err(DeError::custom)?
            .evaluate(&json::Value::Null)
            .map_err(DeError::custom)?;
        let re = Regex::new(r"^(\d+(?:\.\d+)?)%$").expect("should be a valid regex");

        let captures = re.captures(&string).ok_or_else(|| {
            DeError::invalid_value(Unexpected::Str(&string), &"a percentage like `30%`")
        })?;

        Ok(Percent(
            captures
                .get(1)
                .expect("should have capture group")
                .as_str()
                .parse()
                .expect("should be valid digits for percent"),
        ))
    }
}

fn static_json_helper(v: json::Value) -> Result<json::Value, TestError> {
    let v = match v {
        json::Value::Null | json::Value::Bool(_) | json::Value::Number(_) => v,
        json::Value::Object(m) => {
            let m = m
                .into_iter()
                .map(|(k, v)| Ok::<_, TestError>((k, static_json_helper(v)?)))
                .collect::<Result<_, _>>()?;
            json::Value::Object(m)
        }
        json::Value::Array(v) => {
            let v = v
                .into_iter()
                .map(static_json_helper)
                .collect::<Result<_, _>>()?;
            json::Value::Array(v)
        }
        json::Value::String(s) => {
            let sp = BTreeMap::new();
            Template::new(&s, &sp)?.evaluate(&json::Value::Null)?.into()
        }
    };
    Ok(v)
}

fn deserialize_static_json<'de, D>(deserializer: D) -> Result<json::Value, D::Error>
where
    D: Deserializer<'de>,
{
    let v = json::Value::deserialize(deserializer)?;
    static_json_helper(v).map_err(DeError::custom)
}

fn deserialize_path<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let template = String::deserialize(deserializer)?;
    let vars = BTreeMap::new();
    let template = Template::new(&template, &vars).map_err(DeError::custom)?;
    template
        .evaluate(&json::Value::Null)
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
                send: Some(EndpointProvidesSendOptions::Block),
                select: lpp.select,
                for_each: lpp.for_each,
                where_clause: lpp.where_clause,
            };
            (s, eppp)
        })
        .collect();
    Ok(selects)
}

fn deserialize_options_hits_per<'de, D>(deserializer: D) -> Result<Option<HitsPer>, D::Error>
where
    D: Deserializer<'de>,
{
    let string: String = match Option::deserialize(deserializer)? {
        Some(s) => s,
        None => return Ok(None),
    };
    let sp = BTreeMap::new();
    let string = Template::new(&string, &sp)
        .map_err(DeError::custom)?
        .evaluate(&json::Value::Null)
        .map_err(DeError::custom)?;
    let re = Regex::new(r"^(?i)(\d+)\s*hp([ms])$").expect("should be a valid regex");
    let captures = re.captures(&string).ok_or_else(|| {
        DeError::invalid_value(Unexpected::Str(&string), &"example '150 hpm' or '300 hps'")
    })?;
    let n = captures
        .get(1)
        .expect("should have capture group")
        .as_str()
        .parse()
        .expect("should be valid digits for HitsPer");
    if captures.get(2).expect("should have capture group").as_str()[0..1].eq_ignore_ascii_case("m")
    {
        Ok(Some(HitsPer::Minute(n)))
    } else {
        Ok(Some(HitsPer::Second(n)))
    }
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

fn deserialize_duration_helper(dur: &str) -> Option<Duration> {
    let base_re = r"(?i)(\d+)\s*(h|m|s|hrs?|mins?|secs?|hours?|minutes?|seconds?)";
    let sanity_re =
        Regex::new(&format!(r"^(?:{}\s*)+$", base_re)).expect("should be a valid regex");
    if !sanity_re.is_match(dur) {
        return None;
    }
    let mut total_secs = 0;
    let re = Regex::new(base_re).expect("should be a valid regex");
    for captures in re.captures_iter(dur) {
        let n: u64 = captures
            .get(1)
            .expect("should have capture group")
            .as_str()
            .parse()
            .expect("should parse into u64 for duration");
        let unit = &captures.get(2).expect("should have capture group").as_str()[0..1];
        let secs = if unit.eq_ignore_ascii_case("h") {
            n * 60 * 60 // hours
        } else if unit.eq_ignore_ascii_case("m") {
            n * 60 // minutes
        } else {
            n // seconds
        };
        total_secs += secs;
    }
    Some(Duration::from_secs(total_secs))
}

fn deserialize_duration<'de, D>(deserializer: D) -> Result<Duration, D::Error>
where
    D: Deserializer<'de>,
{
    let string = String::deserialize(deserializer)?;
    let sp = BTreeMap::new();
    let dur = Template::new(&string, &sp)
        .map_err(DeError::custom)?
        .evaluate(&json::Value::Null)
        .map_err(DeError::custom)?;
    deserialize_duration_helper(&dur)
        .ok_or_else(|| DeError::invalid_value(Unexpected::Str(&dur), &"example '15m' or '2 hours'"))
}

fn deserialize_duration_option<'de, D>(deserializer: D) -> Result<Option<Duration>, D::Error>
where
    D: Deserializer<'de>,
{
    let string: String = match Option::deserialize(deserializer)? {
        Some(dur) => dur,
        None => return Ok(None),
    };
    let sp = BTreeMap::new();
    let dur = Template::new(&string, &sp)
        .map_err(DeError::custom)?
        .evaluate(&json::Value::Null)
        .map_err(DeError::custom)?;

    deserialize_duration_helper(&dur)
        .ok_or_else(|| DeError::invalid_value(Unexpected::Str(&dur), &"example '15m' or '2 hours'"))
        .map(Some)
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
) -> Result<Option<LoadPattern>, D::Error>
where
    D: Deserializer<'de>,
{
    let ovlppp: Option<Vec<LoadPatternPreProcessed>> = Option::deserialize(deserializer)?;
    let mut builder: Option<LinearBuilder> = None;
    if let Some(vec) = ovlppp {
        let mut last_end = 0f64;
        for lppp in vec {
            match lppp {
                LoadPatternPreProcessed::Linear(lbpp) => {
                    let start = lbpp.from.map(|p| p.0 / 100f64).unwrap_or(last_end);
                    let end = lbpp.to.0 / 100f64;
                    last_end = end;
                    if let Some(ref mut lb) = builder {
                        lb.append(start, end, lbpp.over);
                    } else {
                        builder = Some(LinearBuilder::new(start, end, lbpp.over));
                    }
                }
            }
        }
    }
    Ok(builder.map(LoadPattern::Linear))
}
