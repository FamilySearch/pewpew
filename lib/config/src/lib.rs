mod error;
mod expression_functions;
mod select_parser;

pub use error::Error;
use ether::{Either, Either3};
use http::Method;
use rand::{
    distributions::{Distribution, Uniform},
    Rng,
};
use regex::Regex;
use select_parser::ValueOrExpression;
pub use select_parser::{
    ProviderStream, RequiredProviders, Select, Template, REQUEST_BODY, REQUEST_HEADERS,
    REQUEST_STARTLINE, REQUEST_URL, RESPONSE_BODY, RESPONSE_HEADERS, RESPONSE_STARTLINE, STATS,
};
use serde::{
    de::{Error as DeError, Unexpected},
    Deserialize, Deserializer,
};
use serde_json as json;
use tuple_vec_map;

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    iter,
    num::{NonZeroU16, NonZeroUsize},
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

#[derive(Clone)]
pub enum Limit {
    Auto(Arc<AtomicUsize>),
    Integer(usize),
}

impl Default for Limit {
    fn default() -> Self {
        Limit::auto()
    }
}

impl Limit {
    pub fn auto() -> Limit {
        Limit::Auto(Arc::new(AtomicUsize::new(5)))
    }

    pub fn get(&self) -> usize {
        match self {
            Limit::Auto(a) => a.load(Ordering::Acquire),
            Limit::Integer(n) => *n,
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

#[derive(Debug)]
pub enum HitsPer {
    Second(f32),
    Minute(f32),
}

#[derive(Clone)]
pub struct LinearBuilder {
    pub pieces: Vec<LinearBuilderPiece>,
    pub duration: Duration,
}

impl LinearBuilder {
    pub fn new(start_percent: f64, end_percent: f64, duration: Duration) -> Self {
        let mut ret = LinearBuilder {
            pieces: Vec::new(),
            duration: Duration::from_secs(0),
        };
        ret.append(start_percent, end_percent, duration);
        ret
    }

    pub fn append(&mut self, start_percent: f64, end_percent: f64, duration: Duration) {
        self.duration += duration;
        let duration = duration.as_nanos() as f64;
        let lb = LinearBuilderPiece::new(start_percent, end_percent, duration);
        self.pieces.push(lb);
    }

    pub fn duration(&self) -> Duration {
        self.duration
    }
}

#[derive(Clone)]
pub struct LinearBuilderPiece {
    pub start_percent: f64,
    pub end_percent: f64,
    pub duration: f64,
}

impl LinearBuilderPiece {
    fn new(start_percent: f64, end_percent: f64, duration: f64) -> Self {
        LinearBuilderPiece {
            start_percent,
            end_percent,
            duration,
        }
    }
}

#[serde(rename_all = "snake_case")]
#[derive(Deserialize)]
enum LoadPatternPreProcessed {
    Linear(LinearBuilderPreProcessed),
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct LinearBuilderPreProcessed {
    from: Option<PrePercent>,
    to: PrePercent,
    over: PreDuration,
}

#[derive(Clone)]
pub enum LoadPattern {
    Linear(LinearBuilder),
}

impl LoadPattern {
    pub fn duration(&self) -> Duration {
        match self {
            LoadPattern::Linear(lb) => lb.duration(),
        }
    }

    pub fn builder(self) -> LinearBuilder {
        match self {
            LoadPattern::Linear(lb) => lb,
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
pub enum Provider<F> {
    File(F),
    Range(RangeProvider),
    Response(ResponseProvider),
    List(StaticList),
}

impl<F> Provider<F> {
    fn is_response_provider(&self) -> bool {
        if let Provider::Response(_) = self {
            true
        } else {
            false
        }
    }
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
#[derive(Deserialize)]
struct FileProviderPreProcessed {
    #[serde(default)]
    csv: CsvSettings,
    #[serde(default)]
    auto_return: Option<EndpointProvidesSendOptions>,
    // range 1-65535
    #[serde(default)]
    buffer: Limit,
    #[serde(default)]
    format: FileFormat,
    path: PreTemplate,
    #[serde(default)]
    random: bool,
    #[serde(default)]
    repeat: bool,
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
pub struct LoggerPreProcessed {
    #[serde(default)]
    select: Option<json::Value>,
    #[serde(default)]
    for_each: Vec<String>,
    #[serde(default, rename = "where")]
    where_clause: Option<String>,
    to: PreTemplate,
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

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct EndpointPreProcessed {
    #[serde(default)]
    declare: BTreeMap<String, String>,
    #[serde(default, with = "tuple_vec_map")]
    headers: Vec<(String, Option<String>)>,
    #[serde(default)]
    body: Option<Body>,
    #[serde(default)]
    load_pattern: Option<PreLoadPattern>,
    #[serde(default, deserialize_with = "deserialize_method")]
    method: Method,
    #[serde(default)]
    on_demand: bool,
    #[serde(default)]
    peak_load: Option<PreHitsPer>,
    #[serde(default)]
    tags: BTreeMap<String, String>,
    url: String,
    #[serde(default, deserialize_with = "deserialize_providers")]
    provides: BTreeMap<String, EndpointProvidesPreProcessed>,
    #[serde(default, deserialize_with = "deserialize_logs")]
    logs: Vec<(String, EndpointProvidesPreProcessed)>,
    #[serde(default)]
    max_parallel_requests: Option<NonZeroUsize>,
    #[serde(default)]
    no_auto_returns: bool,
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
#[derive(Copy, Clone, Deserialize)]
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

fn default_keepalive() -> PreDuration {
    PreDuration(PreTemplate("90s".into()))
}

fn default_request_timeout() -> PreDuration {
    PreDuration(PreTemplate("60s".into()))
}

fn default_bucket_size() -> PreDuration {
    PreDuration(PreTemplate("60s".into()))
}

pub fn default_auto_buffer_start_size() -> usize {
    5
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct ClientConfigPreProcessed {
    #[serde(default = "default_request_timeout")]
    request_timeout: PreDuration,
    #[serde(default, with = "tuple_vec_map")]
    headers: Vec<(String, String)>,
    #[serde(default = "default_keepalive")]
    keepalive: PreDuration,
}

pub struct ClientConfig {
    pub request_timeout: Duration,
    pub keepalive: Duration,
}

impl Default for ClientConfigPreProcessed {
    fn default() -> Self {
        ClientConfigPreProcessed {
            request_timeout: default_request_timeout(),
            headers: Vec::new(),
            keepalive: default_keepalive(),
        }
    }
}

pub struct GeneralConfig {
    pub auto_buffer_start_size: usize,
    pub bucket_size: Duration,
    pub log_provider_stats: Option<Duration>,
    pub watch_transition_time: Option<Duration>,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct GeneralConfigPreProcessed {
    #[serde(default = "default_auto_buffer_start_size")]
    auto_buffer_start_size: usize,
    #[serde(default = "default_bucket_size")]
    bucket_size: PreDuration,
    #[serde(default)]
    log_provider_stats: Option<PreDuration>,
    #[serde(default)]
    watch_transition_time: Option<PreDuration>,
}

impl Default for GeneralConfigPreProcessed {
    fn default() -> Self {
        GeneralConfigPreProcessed {
            auto_buffer_start_size: default_auto_buffer_start_size(),
            bucket_size: default_bucket_size(),
            log_provider_stats: None,
            watch_transition_time: None,
        }
    }
}

#[serde(deny_unknown_fields)]
#[derive(Default, Deserialize)]
pub struct Config<C, G> {
    #[serde(default)]
    pub client: C,
    #[serde(default)]
    pub general: G,
}

#[serde(deny_unknown_fields)]
#[derive(Deserialize)]
struct LoadTestPreProcessed {
    #[serde(default)]
    config: Config<ClientConfigPreProcessed, GeneralConfigPreProcessed>,
    endpoints: Vec<EndpointPreProcessed>,
    #[serde(default)]
    load_pattern: Option<PreLoadPattern>,
    #[serde(default, deserialize_with = "deserialize_providers")]
    providers: BTreeMap<String, Provider<FileProviderPreProcessed>>,
    #[serde(default)]
    loggers: BTreeMap<String, LoggerPreProcessed>,
    #[serde(default)]
    vars: BTreeMap<String, PreVar>,
}

#[derive(Default, Deserialize)]
pub struct PreTemplate(String);

impl PreTemplate {
    fn evaluate(&self, static_vars: &BTreeMap<String, json::Value>) -> Result<String, Error> {
        Template::new(&self.0, static_vars, &mut Default::default(), false)
            .and_then(|t| t.evaluate(Cow::Owned(json::Value::Null), None))
    }
}

#[derive(Deserialize)]
pub struct PreVar(json::Value);

impl PreVar {
    fn evaluate(mut self, env_vars: &BTreeMap<String, json::Value>) -> Result<json::Value, Error> {
        fn json_transform(
            v: &mut json::Value,
            env_vars: &BTreeMap<String, json::Value>,
        ) -> Result<(), Error> {
            match v {
                json::Value::String(s) => {
                    let t = Template::new(s, env_vars, &mut Default::default(), false)?;
                    let s = match t.evaluate(Cow::Owned(json::Value::Null), None) {
                        Ok(s) => s,
                        Err(Error::UnknownProvider(s)) => {
                            return Err(Error::MissingEnvironmentVariable(s))
                        }
                        Err(e) => return Err(e),
                    };
                    *v = json::from_str(&s).unwrap_or_else(|_e| json::Value::String(s));
                }
                json::Value::Array(a) => {
                    for v in a.iter_mut() {
                        json_transform(v, env_vars)?;
                    }
                }
                json::Value::Object(o) => {
                    for v in o.values_mut() {
                        json_transform(v, env_vars)?;
                    }
                }
                _ => (),
            }
            Ok(())
        }

        json_transform(&mut self.0, env_vars)?;
        Ok(self.0)
    }
}

#[derive(Deserialize)]
pub struct PreDuration(PreTemplate);

impl PreDuration {
    fn evaluate(&self, static_vars: &BTreeMap<String, json::Value>) -> Result<Duration, Error> {
        let dur = self.0.evaluate(static_vars)?;
        let base_re = r"(?i)(\d+)\s*(d|h|m|s|days?|hrs?|mins?|secs?|hours?|minutes?|seconds?)";
        let sanity_re =
            Regex::new(&format!(r"^(?:{}\s*)+$", base_re)).expect("should be a valid regex");
        if !sanity_re.is_match(&dur) {
            return Err(Error::InvalidDuration(dur));
        }
        let mut total_secs = 0;
        let re = Regex::new(base_re).expect("should be a valid regex");
        for captures in re.captures_iter(&dur) {
            let n: u64 = captures
                .get(1)
                .expect("should have capture group")
                .as_str()
                .parse()
                .expect("should parse into u64 for duration");
            let unit = &captures.get(2).expect("should have capture group").as_str()[0..1];
            let secs = if unit.eq_ignore_ascii_case("d") {
                n * 60 * 60 * 24 // days
            } else if unit.eq_ignore_ascii_case("h") {
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
}

#[derive(Deserialize)]
pub struct PrePercent(PreTemplate);

impl PrePercent {
    fn evaluate(&self, static_vars: &BTreeMap<String, json::Value>) -> Result<f64, Error> {
        let string = self.0.evaluate(static_vars)?;
        let re = Regex::new(r"^(\d+(?:\.\d+)?)%$").expect("should be a valid regex");

        let captures = re
            .captures(&string)
            .ok_or_else(|| Error::InvalidPercent(string.clone()))?;

        Ok(captures
            .get(1)
            .expect("should have capture group")
            .as_str()
            .parse()
            .expect("should be valid digits for percent"))
    }
}

#[derive(Deserialize)]
pub struct PreLoadPattern(Vec<LoadPatternPreProcessed>);

impl PreLoadPattern {
    fn evaluate(&self, static_vars: &BTreeMap<String, json::Value>) -> Result<LoadPattern, Error> {
        let mut builder: Option<LinearBuilder> = None;
        let mut last_end = 0f64;
        for lppp in &self.0 {
            match lppp {
                LoadPatternPreProcessed::Linear(lbpp) => {
                    let start = lbpp
                        .from
                        .as_ref()
                        .map(|p| Ok::<_, Error>(p.evaluate(static_vars)? / 100f64))
                        .unwrap_or_else(|| Ok(last_end))?;
                    let to = lbpp.to.evaluate(static_vars)?;
                    let end = to / 100f64;
                    let over = lbpp.over.evaluate(static_vars)?;
                    last_end = end;
                    if let Some(ref mut lb) = builder {
                        lb.append(start, end, over);
                    } else {
                        builder = Some(LinearBuilder::new(start, end, over));
                    }
                }
            }
        }
        builder
            .ok_or_else(|| Error::InvalidLoadPattern)
            .map(LoadPattern::Linear)
    }
}

#[derive(Deserialize)]
pub struct PreHitsPer(PreTemplate);

impl PreHitsPer {
    fn evaluate(&self, static_vars: &BTreeMap<String, json::Value>) -> Result<HitsPer, Error> {
        let string = self.0.evaluate(static_vars)?;
        let re = Regex::new(r"^(?i)(\d+)\s*hp([ms])$").expect("should be a valid regex");
        let captures = re
            .captures(&string)
            .ok_or_else(|| Error::InvalidPeakLoad(string.clone()))?;
        let n = captures
            .get(1)
            .expect("should have capture group")
            .as_str()
            .parse()
            .expect("should be valid digits for HitsPer");
        if captures.get(2).expect("should have capture group").as_str()[0..1]
            .eq_ignore_ascii_case("m")
        {
            Ok(HitsPer::Minute(n))
        } else {
            Ok(HitsPer::Second(n))
        }
    }
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

fn deserialize_providers<'de, D, T>(deserializer: D) -> Result<BTreeMap<String, T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    let map: BTreeMap<String, T> = BTreeMap::deserialize(deserializer)?;
    for k in map.keys() {
        if k == "request" || k == "response" || k == "for_each" || k == "stats" {
            return Err(DeError::invalid_value(
                Unexpected::Str(&k),
                &"Use of reserved provider name",
            ));
        }
    }
    Ok(map)
}

fn deserialize_method<'de, D>(deserializer: D) -> Result<Method, D::Error>
where
    D: Deserializer<'de>,
{
    let string = String::deserialize(deserializer)?;
    Method::from_bytes(string.as_bytes())
        .map_err(|_| DeError::invalid_value(Unexpected::Str(&string), &"a valid HTTP method verb"))
}

pub struct LoadTest {
    pub config: Config<ClientConfig, GeneralConfig>,
    pub endpoints: Vec<Endpoint>,
    pub providers: BTreeMap<String, Provider<FileProvider>>,
    pub loggers: BTreeMap<String, Logger>,
    vars: BTreeMap<String, json::Value>,
    load_test_errors: Vec<Error>,
}

#[derive(Default)]
pub struct FileProvider {
    pub csv: CsvSettings,
    pub auto_return: Option<EndpointProvidesSendOptions>,
    // range 1-65535
    pub buffer: Limit,
    pub format: FileFormat,
    pub path: String,
    pub random: bool,
    pub repeat: bool,
}

pub struct Logger {
    pub to: String,
    pub pretty: bool,
    pub limit: Option<usize>,
    pub kill: bool,
}

impl Logger {
    pub fn from_pre_processed(
        logger: LoggerPreProcessed,
        vars: &BTreeMap<String, json::Value>,
        required_providers: &mut RequiredProviders,
    ) -> Result<(Self, Option<Select>), Error> {
        let LoggerPreProcessed {
            pretty,
            to,
            limit,
            kill,
            for_each,
            where_clause,
            select,
        } = logger;
        let select = select.map(|select| EndpointProvidesPreProcessed {
            send: Some(EndpointProvidesSendOptions::Block),
            select,
            for_each,
            where_clause,
        });
        let select = select
            .map(|s| Select::new(s, vars, required_providers, true))
            .transpose()?;
        let to = to.evaluate(vars)?;
        let logger = Logger {
            to,
            pretty,
            limit,
            kill,
        };
        Ok((logger, select))
    }
}

pub struct Endpoint {
    pub body: BodyTemplate,
    pub declare: Vec<(String, ValueOrExpression)>,
    pub headers: Vec<(String, Template)>,
    pub load_pattern: Option<LoadPattern>,
    pub logs: Vec<(String, Select)>,
    pub max_parallel_requests: Option<NonZeroUsize>,
    pub method: Method,
    pub no_auto_returns: bool,
    pub on_demand: bool,
    pub peak_load: Option<HitsPer>,
    pub provides: Vec<(String, Select)>,
    pub providers_to_stream: RequiredProviders,
    pub required_providers: RequiredProviders,
    pub tags: BTreeMap<String, Template>,
    pub url: Template,
}

pub struct MultipartPiece {
    pub name: String,
    pub headers: Vec<(String, Template)>,
    pub is_file: bool,
    pub template: Template,
}

pub struct MultipartBody {
    pub path: PathBuf,
    pub pieces: Vec<MultipartPiece>,
}

pub enum BodyTemplate {
    File(PathBuf, Template),
    Multipart(MultipartBody),
    None,
    String(Template),
}

impl Endpoint {
    fn from_preprocessed(
        endpoint: EndpointPreProcessed,
        endpoint_id: usize,
        static_vars: &BTreeMap<String, json::Value>,
        global_load_pattern: &Option<LoadPattern>,
        global_headers: &[(String, (Template, RequiredProviders))],
        config_path: &PathBuf,
    ) -> Result<Self, Error> {
        let EndpointPreProcessed {
            declare,
            headers,
            body,
            load_pattern,
            logs,
            max_parallel_requests,
            method,
            no_auto_returns,
            on_demand,
            peak_load,
            provides,
            url,
            mut tags,
        } = endpoint;
        let mut required_providers = RequiredProviders::new();

        let mut headers_to_remove = BTreeSet::new();
        let mut headers_to_add = Vec::new();
        for (k, v) in headers {
            if let Some(v) = v {
                let v = Template::new(&v, static_vars, &mut required_providers, false)?;
                headers_to_add.push((k, v));
            } else {
                headers_to_remove.insert(k);
            }
        }
        let mut headers: Vec<_> = global_headers
            .iter()
            .filter_map(|(k, (v, rp))| {
                if headers_to_remove.contains(k) {
                    None
                } else {
                    required_providers.extend(rp.clone());
                    Some((k.clone(), v.clone()))
                }
            })
            .collect();
        headers.extend(headers_to_add);

        let provides = provides
            .into_iter()
            .map(|(key, mut value)| {
                if value.send.is_none() {
                    value.send = if peak_load.is_some() {
                        Some(EndpointProvidesSendOptions::IfNotFull)
                    } else {
                        Some(EndpointProvidesSendOptions::Block)
                    };
                }
                let value = Select::new(value, static_vars, &mut required_providers, false)?;
                Ok((key, value))
            })
            .collect::<Result<_, Error>>()?;

        let load_pattern = load_pattern
            .map(|l| l.evaluate(static_vars))
            .transpose()?
            .or_else(|| global_load_pattern.clone());

        let peak_load = peak_load.map(|p| p.evaluate(static_vars)).transpose()?;

        let url = Template::new(&url, static_vars, &mut required_providers, false)?;

        tags.insert("_id".into(), endpoint_id.to_string());
        tags.entry("url".into())
            .or_insert_with(|| url.evaluate_with_star());
        tags.insert("method".into(), method.to_string());
        let tags = tags
            .into_iter()
            .map(|(key, value)| {
                let value = Template::new(&value, static_vars, &mut required_providers, true)?;
                Ok((key, value))
            })
            .collect::<Result<_, Error>>()?;

        let body = body
            .map(|body| {
                let value = match body {
                    Body::File(body) => {
                        let template =
                            Template::new(&body, static_vars, &mut required_providers, false)?;
                        BodyTemplate::File(config_path.clone(), template)
                    }
                    Body::String(body) => {
                        let template =
                            Template::new(&body, static_vars, &mut required_providers, false)?;
                        BodyTemplate::String(template)
                    }
                    Body::Multipart(multipart) => {
                        let pieces = multipart
                            .into_iter()
                            .map(|(name, v)| {
                                let (is_file, template) = match v.body {
                                    BodyMultipartPieceBody::File(f) => {
                                        let template = Template::new(
                                            &f,
                                            static_vars,
                                            &mut required_providers,
                                            false,
                                        )?;
                                        (true, template)
                                    }
                                    BodyMultipartPieceBody::String(s) => {
                                        let template = Template::new(
                                            &s,
                                            static_vars,
                                            &mut required_providers,
                                            false,
                                        )?;
                                        (false, template)
                                    }
                                };
                                let headers = v
                                    .headers
                                    .into_iter()
                                    .map(|(k, v)| {
                                        let template = Template::new(
                                            &v,
                                            static_vars,
                                            &mut required_providers,
                                            false,
                                        )?;
                                        Ok::<_, Error>((k, template))
                                    })
                                    .collect::<Result<_, _>>()?;

                                let piece = MultipartPiece {
                                    name,
                                    headers,
                                    is_file,
                                    template,
                                };
                                Ok::<_, Error>(piece)
                            })
                            .collect::<Result<_, _>>()?;
                        let multipart = MultipartBody {
                            path: config_path.clone(),
                            pieces,
                        };
                        BodyTemplate::Multipart(multipart)
                    }
                };
                Ok::<_, Error>(value)
            })
            .transpose()?
            .unwrap_or(BodyTemplate::None);

        let mut providers_to_stream = required_providers;
        let mut required_providers2 = RequiredProviders::new();
        let declare = declare
            .into_iter()
            .map(|(key, value)| {
                providers_to_stream.remove(&key);
                let value =
                    ValueOrExpression::new(&value, &mut required_providers2, static_vars, false)?;
                Ok((key, value))
            })
            .collect::<Result<_, Error>>()?;
        required_providers2.extend(providers_to_stream.clone());
        let required_providers = required_providers2;

        let mut endpoint = Endpoint {
            declare,
            headers,
            body,
            load_pattern,
            logs: Default::default(),
            max_parallel_requests,
            method,
            no_auto_returns,
            on_demand,
            peak_load,
            provides,
            providers_to_stream,
            required_providers,
            url,
            tags,
        };

        for (key, value) in logs {
            endpoint.append_logger(key, value, static_vars)?;
        }

        Ok(endpoint)
    }

    fn append_logger(
        &mut self,
        key: String,
        value: EndpointProvidesPreProcessed,
        static_vars: &BTreeMap<String, json::Value>,
    ) -> Result<(), Error> {
        let value = Select::new(value, static_vars, &mut self.providers_to_stream, true)?;
        self.append_processed_logger(key, value, None);
        Ok(())
    }

    fn append_processed_logger(
        &mut self,
        key: String,
        value: Select,
        required_providers: Option<RequiredProviders>,
    ) {
        self.logs.push((key, value));
        if let Some(required_providers) = required_providers {
            self.providers_to_stream.extend(required_providers.clone());
            self.required_providers.extend(required_providers);
        }
    }
}

impl LoadTest {
    pub fn from_config(
        bytes: &[u8],
        config_path: &PathBuf,
        env_vars: &BTreeMap<String, String>,
    ) -> Result<Self, Error> {
        let env_vars = env_vars
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().into()))
            .collect();
        let c: LoadTestPreProcessed =
            serde_yaml::from_slice(bytes).map_err(|e| Error::InvalidYaml(e.into()))?;
        let vars: BTreeMap<String, json::Value> = c
            .vars
            .into_iter()
            .map(|(k, v)| Ok::<_, Error>((k, v.evaluate(&env_vars)?)))
            .collect::<Result<_, _>>()?;
        let loggers = c.loggers;
        let providers = c.providers;
        let global_load_pattern = c.load_pattern.map(|l| l.evaluate(&vars)).transpose()?;
        let global_headers: Vec<_> = c
            .config
            .client
            .headers
            .iter()
            .map(|(key, value)| {
                let mut required_providers = RequiredProviders::new();
                let value = Template::new(&value, &vars, &mut required_providers, false)?;
                Ok((key.clone(), (value, required_providers)))
            })
            .collect::<Result<_, Error>>()?;
        let config = Config {
            client: ClientConfig {
                keepalive: c.config.client.keepalive.evaluate(&vars)?,
                request_timeout: c.config.client.request_timeout.evaluate(&vars)?,
            },
            general: GeneralConfig {
                auto_buffer_start_size: c.config.general.auto_buffer_start_size,
                bucket_size: c.config.general.bucket_size.evaluate(&vars)?,
                log_provider_stats: c
                    .config
                    .general
                    .log_provider_stats
                    .map(|b| b.evaluate(&vars))
                    .transpose()?,
                watch_transition_time: c
                    .config
                    .general
                    .watch_transition_time
                    .map(|b| b.evaluate(&vars))
                    .transpose()?,
            },
        };
        let mut load_test_errors = Vec::new();
        let endpoints = c
            .endpoints
            .into_iter()
            .enumerate()
            .map(|(i, e)| {
                let e = Endpoint::from_preprocessed(
                    e,
                    i,
                    &vars,
                    &global_load_pattern,
                    &global_headers,
                    config_path,
                )?;

                // check for errors which would prevent a load test (but are ok for a try run)
                if e.peak_load.is_none() {
                    let requires_response_provider = e.required_providers.iter().any(|p| {
                        providers
                            .get(p)
                            .map(Provider::is_response_provider)
                            .unwrap_or_default()
                    });
                    let has_provides_send_block = e
                        .provides
                        .iter()
                        .any(|(_, v)| v.get_send_behavior().is_block());
                    if !has_provides_send_block && !requires_response_provider {
                        // endpoint should have a peak_load, have a provides which is send_block, or depend upon a response provider
                        load_test_errors.push(Error::MissingPeakLoad);
                    }
                } else if e.load_pattern.is_none() {
                    // endpoint is missing a load_pattern
                    load_test_errors.push(Error::MissingLoadPattern);
                }

                Ok(e)
            })
            .collect::<Result<_, Error>>()?;
        let providers = providers
            .into_iter()
            .map(|(key, value)| {
                let value = match value {
                    Provider::File(f) => {
                        let FileProviderPreProcessed {
                            csv,
                            auto_return,
                            buffer,
                            format,
                            path,
                            random,
                            repeat,
                        } = f;
                        let path = path.evaluate(&vars)?;
                        let f = FileProvider {
                            csv,
                            auto_return,
                            buffer,
                            format,
                            path,
                            random,
                            repeat,
                        };
                        Provider::File(f)
                    }
                    Provider::Range(r) => Provider::Range(r),
                    Provider::Response(r) => Provider::Response(r),
                    Provider::List(l) => Provider::List(l),
                };
                Ok((key, value))
            })
            .collect::<Result<_, Error>>()?;

        let mut loadtest = LoadTest {
            config,
            endpoints,
            providers,
            loggers: Default::default(),
            vars,
            load_test_errors,
        };

        for (key, value) in loggers {
            loadtest.add_logger(key, value)?;
        }

        // validate each endpoint only references valid loggers and providers
        for e in &loadtest.endpoints {
            loadtest.verify_loggers(e.logs.iter().map(|(l, _)| l))?;
            let providers = e.provides.iter().map(|(k, _)| k);
            let providers = e.required_providers.iter().chain(providers);
            loadtest.verify_providers(providers)?;
        }

        Ok(loadtest)
    }

    pub fn get_duration(&self) -> Duration {
        self.endpoints
            .iter()
            .filter_map(|e| e.load_pattern.as_ref().map(LoadPattern::duration))
            .max()
            .unwrap_or_default()
    }

    pub fn add_logger(&mut self, key: String, value: LoggerPreProcessed) -> Result<(), Error> {
        let mut required_providers = RequiredProviders::new();
        let (value, select) =
            Logger::from_pre_processed(value, &self.vars, &mut required_providers)?;
        self.loggers.insert(key.clone(), value);
        self.verify_providers(required_providers.iter())?;
        if let Some(select) = select {
            for endpoint in &mut self.endpoints {
                endpoint.append_processed_logger(
                    key.clone(),
                    select.clone(),
                    Some(required_providers.clone()),
                );
            }
        }
        Ok(())
    }

    pub fn clear_loggers(&mut self) {
        self.loggers.clear();
        for endpoint in &mut self.endpoints {
            endpoint.logs.clear();
        }
    }

    pub fn ok_for_loadtest(&self) -> Result<(), Error> {
        self.load_test_errors
            .get(0)
            .cloned()
            .map(Err::<(), _>)
            .transpose()
            .map(|_| ())
    }

    fn verify_loggers<'a, I: Iterator<Item = &'a String>>(
        &self,
        mut loggers: I,
    ) -> Result<(), Error> {
        if let Some(l) = loggers.find(|l| !self.loggers.contains_key(*l)) {
            Err(Error::UnknownLogger(l.clone()))
        } else {
            Ok(())
        }
    }

    fn verify_providers<'a, I: Iterator<Item = &'a String>>(
        &self,
        mut providers: I,
    ) -> Result<(), Error> {
        if let Some(p) = providers.find(|p| !self.providers.contains_key(*p)) {
            Err(Error::UnknownProvider(p.clone()))
        } else {
            Ok(())
        }
    }
}

pub(crate) fn json_value_to_string(v: Cow<'_, json::Value>) -> Cow<'_, String> {
    match v {
        Cow::Owned(json::Value::String(s)) => Cow::Owned(s),
        Cow::Borrowed(json::Value::String(s)) => Cow::Borrowed(s),
        _ => Cow::Owned(v.to_string()),
    }
}
