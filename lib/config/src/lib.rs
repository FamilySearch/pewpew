// #[macro_use]
// extern crate from_yaml_derive;

mod error;
mod expression_functions;
mod from_yaml;
mod select_parser;

pub use error::{Error, ExpressionError};
use ether::{Either, Either3};
pub use from_yaml::FromYaml;
use from_yaml::{Nullable, ParseResult, TupleVec, YamlDecoder, YamlEvent};
use http::Method;
use rand::{
    distributions::{Distribution, Uniform},
    Rng,
};
use regex::Regex;
use select_parser::ValueOrExpression;
pub use select_parser::{
    ProviderStream, RequiredProviders, Select, Template, REQUEST_BODY, REQUEST_HEADERS,
    REQUEST_HEADERS_ALL, REQUEST_STARTLINE, REQUEST_URL, RESPONSE_BODY, RESPONSE_HEADERS,
    RESPONSE_HEADERS_ALL, RESPONSE_STARTLINE, STATS,
};
use serde_json as json;
use yaml_rust::scanner::{Marker, Scanner};

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

fn map_yaml_deserialize_err(name: String) -> impl FnOnce(Error) -> Error {
    |mut err| {
        if let Error::YamlDeserialize(ref mut o @ None, _)
        | Error::UnrecognizedKey(_, ref mut o @ None, _) = err
        {
            *o = Some(name)
        }
        err
    }
}

impl FromYaml for Method {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        let method = match event.as_str().map(|s| s.trim()) {
            Some("POST") => Method::POST,
            Some("GET") => Method::GET,
            Some("PUT") => Method::PUT,
            Some("HEAD") => Method::HEAD,
            Some("DELETE") => Method::DELETE,
            Some("OPTIONS") => Method::OPTIONS,
            Some("CONNECT") => Method::CONNECT,
            Some("PATCH") => Method::PATCH,
            Some("TRACE") => Method::TRACE,
            _ => return Err(Error::YamlDeserialize(None, marker)),
        };
        Ok((method, marker))
    }
}

#[derive(Clone, Debug)]
pub enum Limit {
    Auto(Arc<AtomicUsize>),
    Integer(usize),
}

impl FromYaml for Limit {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        match event.as_x() {
            Some(i) => return Ok((Limit::Integer(i), marker)),
            None => {
                if let Some("auto") = event.as_str() {
                    return Ok((Limit::auto(), marker));
                }
            }
        }
        Err(Error::YamlDeserialize(None, marker))
    }
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

trait DefaultWithMarker {
    fn default(marker: Marker) -> Self;
}

#[cfg_attr(test, derive(Debug, PartialEq))]
enum LoadPatternPreProcessed {
    Linear(LinearBuilderPreProcessed),
}

impl FromYaml for LoadPatternPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        match event {
            YamlEvent::MappingStart => (),
            _ => return Err(Error::YamlDeserialize(None, marker)),
        }
        let (event, marker) = decoder.next()?;
        let ret = match event.into_string() {
            Ok(s) if s.as_str() == "linear" => {
                let (linear, marker) = FromYaml::parse(decoder)?;
                (LoadPatternPreProcessed::Linear(linear), marker)
            }
            Ok(s) => return Err(Error::UnrecognizedKey(s, None, marker)),
            Err(_) => return Err(Error::YamlDeserialize(None, marker)),
        };
        let (event, marker) = decoder.next()?;
        match event {
            YamlEvent::MappingEnd => (),
            _ => return Err(Error::YamlDeserialize(None, marker)),
        }
        Ok(ret)
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct LinearBuilderPreProcessed {
    from: Option<PrePercent>,
    to: PrePercent,
    over: PreDuration,
}

impl FromYaml for LinearBuilderPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut from = None;
        let mut to = None;
        let mut over = None;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "from" => {
                        let c = FromYaml::parse_into(decoder)?;
                        from = Some(c);
                    }
                    "to" => {
                        let a = FromYaml::parse_into(decoder)?;
                        to = Some(a);
                    }
                    "over" => {
                        let b = FromYaml::parse_into(decoder)?;
                        over = Some(b);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let to = to.ok_or_else(|| Error::MissingYamlField("to", marker))?;
        let over = over.ok_or_else(|| Error::MissingYamlField("over", marker))?;
        let ret = Self { from, to, over };
        Ok((ret, marker))
    }
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

#[cfg_attr(test, derive(Debug, PartialEq))]
pub struct ExplicitStaticList {
    pub random: bool,
    pub repeat: bool,
    pub values: Vec<json::Value>,
}

impl FromYaml for ExplicitStaticList {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut saw_opening = false;
        let mut random = false;
        let mut repeat = true;
        let mut values = None;
        let mut first_marker = None;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "random" => {
                        let (r, _): (bool, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        random = r;
                    }
                    "repeat" => {
                        let (r, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        repeat = r;
                    }
                    "values" => {
                        let (v, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        values = Some(v);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let values = values.ok_or_else(|| Error::MissingYamlField("values", marker))?;
        let ret = Self {
            random,
            repeat,
            values,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
pub enum StaticList {
    Explicit(ExplicitStaticList),
    Implicit(Vec<json::Value>),
}

impl FromYaml for StaticList {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.peek()?;
        match event {
            YamlEvent::SequenceStart => {
                let (e, marker) = FromYaml::parse(decoder)?;
                let value = (StaticList::Implicit(e), marker);
                Ok(value)
            }
            YamlEvent::MappingStart => {
                let (i, marker) = FromYaml::parse(decoder)?;
                let value = (StaticList::Explicit(i), marker);
                Ok(value)
            }
            _ => Err(Error::YamlDeserialize(None, *marker)),
        }
    }
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

#[cfg_attr(test, derive(Debug, PartialEq))]
enum ProviderPreProcessed {
    File(FileProviderPreProcessed),
    Range(RangeProviderPreProcessed),
    Response(ResponseProvider),
    List(StaticList),
}

pub enum Provider {
    File(FileProvider),
    Range(RangeProvider),
    Response(ResponseProvider),
    List(StaticList),
}

impl FromYaml for ProviderPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut first_marker = None;
        let mut saw_opening = false;
        let ret = loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "file" => {
                        let (c, marker) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        break (ProviderPreProcessed::File(c), marker);
                    }
                    "range" => {
                        let (c, marker) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        break (ProviderPreProcessed::Range(c), marker);
                    }
                    "response" => {
                        let (c, marker) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        break (ProviderPreProcessed::Response(c), marker);
                    }
                    "list" => {
                        let (c, marker) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        break (ProviderPreProcessed::List(c), marker);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        };
        let (event, marker) = decoder.next()?;
        match event {
            YamlEvent::MappingEnd => (),
            _ => return Err(Error::YamlDeserialize(None, marker)),
        }
        Ok(ret)
    }
}

impl ProviderPreProcessed {
    fn is_response_provider(&self) -> bool {
        if let ProviderPreProcessed::Response(_) = self {
            true
        } else {
            false
        }
    }
}

type RangeProviderIteratorA = iter::StepBy<std::ops::RangeInclusive<i64>>;

pub struct RangeProvider(pub Either<RangeProviderIteratorA, iter::Cycle<RangeProviderIteratorA>>);

impl From<RangeProviderPreProcessed> for RangeProvider {
    fn from(rppp: RangeProviderPreProcessed) -> Self {
        let start = rppp.start;
        let end = rppp.end;
        let step = rppp.step.get().into();
        let iter = (start..=end).step_by(step);
        let iter = if rppp.repeat {
            Either::B(iter.cycle())
        } else {
            Either::A(iter)
        };
        RangeProvider(iter)
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
pub struct RangeProviderPreProcessed {
    start: i64,
    end: i64,
    step: NonZeroU16,
    repeat: bool,
}

impl FromYaml for RangeProviderPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut saw_opening = false;

        let mut start = 0;
        let mut end = std::i64::MAX;
        let mut step = NonZeroU16::new(1).expect("1 is non-zero");
        let mut repeat = false;

        let mut first_marker = None;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "start" => {
                        let (s, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        start = s;
                    }
                    "end" => {
                        let (e, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        end = e;
                    }
                    "step" => {
                        let (s, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        step = s;
                    }
                    "repeat" => {
                        let (r, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        repeat = r;
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let ret = Self {
            start,
            end,
            step,
            repeat,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
pub enum FileFormat {
    Csv,
    Json,
    Line,
}

impl FromYaml for FileFormat {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        let format = match event.as_str() {
            Some("csv") => FileFormat::Csv,
            Some("json") => FileFormat::Json,
            Some("line") => FileFormat::Line,
            _ => return Err(Error::YamlDeserialize(None, marker)),
        };
        Ok((format, marker))
    }
}

impl Default for FileFormat {
    fn default() -> Self {
        FileFormat::Line
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
pub enum CsvHeader {
    Bool(bool),
    String(String),
}

impl FromYaml for CsvHeader {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        match event.as_bool() {
            Some(b) => Ok((CsvHeader::Bool(b), marker)),
            None => event
                .into_string()
                .map(|s| (CsvHeader::String(s), marker))
                .map_err(|_| Error::YamlDeserialize(None, marker)),
        }
    }
}

impl Default for CsvHeader {
    fn default() -> Self {
        CsvHeader::Bool(false)
    }
}

fn from_yaml_char_u8<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> Result<u8, Error> {
    let (event, marker) = decoder.next()?;
    match event.as_x::<char>() {
        Some(c) if c.is_ascii() => {
            let mut b = [0; 1];
            let _ = c.encode_utf8(&mut b);
            Ok(b[0])
        }
        _ => Err(Error::YamlDeserialize(None, marker)),
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
#[derive(Default)]
pub struct CsvSettings {
    pub comment: Option<u8>,
    pub delimiter: Option<u8>,
    pub double_quote: Option<bool>,
    pub escape: Option<u8>,
    pub headers: CsvHeader,
    pub terminator: Option<u8>,
    pub quote: Option<u8>,
}

impl FromYaml for CsvSettings {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut comment = None;
        let mut delimiter = None;
        let mut double_quote = None;
        let mut escape = None;
        let mut headers = None;
        let mut terminator = None;
        let mut quote = None;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "comment" => {
                        let c = from_yaml_char_u8(decoder).map_err(map_yaml_deserialize_err(s))?;
                        comment = Some(c);
                    }
                    "delimiter" => {
                        let a = from_yaml_char_u8(decoder).map_err(map_yaml_deserialize_err(s))?;
                        delimiter = Some(a);
                    }
                    "double_quote" => {
                        let (b, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        double_quote = Some(b);
                    }
                    "escape" => {
                        let f = from_yaml_char_u8(decoder).map_err(map_yaml_deserialize_err(s))?;
                        escape = Some(f);
                    }
                    "headers" => {
                        let (p, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        headers = Some(p);
                    }
                    "terminator" => {
                        let r = from_yaml_char_u8(decoder).map_err(map_yaml_deserialize_err(s))?;
                        terminator = Some(r);
                    }
                    "quote" => {
                        let r = from_yaml_char_u8(decoder).map_err(map_yaml_deserialize_err(s))?;
                        quote = Some(r);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let headers = headers.unwrap_or_default();
        let ret = Self {
            comment,
            delimiter,
            double_quote,
            escape,
            headers,
            terminator,
            quote,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct FileProviderPreProcessed {
    csv: CsvSettings,
    auto_return: Option<EndpointProvidesSendOptions>,
    // range 1-65535
    buffer: Limit,
    format: FileFormat,
    path: PreTemplate,
    random: bool,
    repeat: bool,
}

impl FromYaml for FileProviderPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut csv = None;
        let mut auto_return = None;
        let mut buffer = None;
        let mut format = None;
        let mut path = None;
        let mut random = false;
        let mut repeat = false;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "csv" => {
                        let (c, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        csv = Some(c);
                    }
                    "auto_return" => {
                        let (a, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        auto_return = Some(a);
                    }
                    "buffer" => {
                        let (b, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        buffer = Some(b);
                    }
                    "format" => {
                        let (f, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        format = Some(f);
                    }
                    "path" => {
                        let (s, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        let p = PreTemplate::new(s);
                        path = Some(p);
                    }
                    "random" => {
                        let (r, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        random = r;
                    }
                    "repeat" => {
                        let (r, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        repeat = r;
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let csv = csv.unwrap_or_default();
        let buffer = buffer.unwrap_or_default();
        let format = format.unwrap_or_default();
        let path = path.ok_or_else(|| Error::MissingYamlField("path", marker))?;
        let ret = Self {
            csv,
            auto_return,
            buffer,
            format,
            path,
            random,
            repeat,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
pub struct ResponseProvider {
    pub auto_return: Option<EndpointProvidesSendOptions>,
    pub buffer: Limit,
}

impl FromYaml for ResponseProvider {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut auto_return = None;
        let mut buffer = None;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "auto_return" => {
                        let c =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        auto_return = Some(c);
                    }
                    "buffer" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        buffer = Some(a);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let buffer = buffer.unwrap_or_default();
        let ret = Self {
            auto_return,
            buffer,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
pub struct LoggerPreProcessed {
    select: Option<WithMarker<json::Value>>,
    for_each: Vec<WithMarker<String>>,
    where_clause: Option<WithMarker<String>>,
    to: PreTemplate,
    pretty: bool,
    limit: Option<usize>,
    kill: bool,
}

impl LoggerPreProcessed {
    pub fn from_str(select: &str, to: &str) -> Result<Self, Error> {
        let mut decoder = YamlDecoder::new(select.chars());
        let select = FromYaml::parse_into(&mut decoder)?;
        decoder = YamlDecoder::new(to.chars());
        let to = FromYaml::parse_into(&mut decoder)?;
        Ok(LoggerPreProcessed {
            select: Some(select),
            for_each: Default::default(),
            where_clause: None,
            to,
            pretty: false,
            limit: None,
            kill: false,
        })
    }
}

impl FromYaml for LoggerPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut select = None;
        let mut for_each = None;
        let mut where_clause = None;
        let mut to = None;
        let mut pretty = false;
        let mut limit = None;
        let mut kill = false;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "select" => {
                        let c =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        select = Some(c);
                    }
                    "for_each" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        for_each = Some(a);
                    }
                    "where" => {
                        let b =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        where_clause = Some(b);
                    }
                    "to" => {
                        let b =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        to = Some(b);
                    }
                    "pretty" => {
                        let b =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        pretty = b;
                    }
                    "limit" => {
                        let b =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        limit = Some(b);
                    }
                    "kill" => {
                        let b =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        kill = b;
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let to = to.ok_or_else(|| Error::MissingYamlField("to", marker))?;
        let for_each = for_each.unwrap_or_default();
        let ret = Self {
            select,
            for_each,
            where_clause,
            to,
            pretty,
            limit,
            kill,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct LogsPreProcessed {
    select: WithMarker<json::Value>,
    for_each: Vec<WithMarker<String>>,
    where_clause: Option<WithMarker<String>>,
}

impl FromYaml for LogsPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut select = None;
        let mut for_each = None;
        let mut where_clause = None;
        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "select" => {
                        let r =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        select = Some(r);
                    }
                    "for_each" => {
                        let r =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        for_each = Some(r);
                    }
                    "where" => {
                        let v =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        where_clause = Some(v);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let select = select.ok_or_else(|| Error::MissingYamlField("select", marker))?;
        let for_each = for_each.unwrap_or_default();
        let ret = Self {
            select,
            for_each,
            where_clause,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug))]
struct EndpointPreProcessed {
    declare: BTreeMap<String, PreValueOrExpression>,
    headers: TupleVec<String, Nullable<PreTemplate>>,
    body: Option<Body>,
    load_pattern: Option<PreLoadPattern>,
    method: Method,
    on_demand: bool,
    peak_load: Option<PreHitsPer>,
    tags: BTreeMap<String, PreTemplate>,
    url: PreTemplate,
    provides: TupleVec<String, EndpointProvidesPreProcessed>,
    logs: TupleVec<String, LogsPreProcessed>,
    max_parallel_requests: Option<NonZeroUsize>,
    no_auto_returns: bool,
    request_timeout: Option<PreDuration>,
    marker: Marker,
}

#[cfg(test)]
impl PartialEq for EndpointPreProcessed {
    fn eq(&self, other: &Self) -> bool {
        self.declare == other.declare
            && self.headers == other.headers
            && self.body == other.body
            && self.load_pattern == other.load_pattern
            && self.method == other.method
            && self.on_demand == other.on_demand
            && self.peak_load == other.peak_load
            && self.tags == other.tags
            && self.url == other.url
            && self.provides == other.provides
            && self.logs == other.logs
            && self.max_parallel_requests == other.max_parallel_requests
            && self.no_auto_returns == other.no_auto_returns
            && self.request_timeout == other.request_timeout
    }
}

impl FromYaml for EndpointPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut declare = None;
        let mut headers = None;
        let mut body = None;
        let mut load_pattern = None;
        let mut method = None;
        let mut on_demand = None;
        let mut peak_load = None;
        let mut tags = None;
        let mut url = None;
        let mut provides = None;
        let mut logs = None;
        let mut max_parallel_requests = None;
        let mut no_auto_returns = None;
        let mut request_timeout = None;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "declare" => {
                        let c =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        declare = Some(c);
                    }
                    "headers" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        headers = Some(a);
                    }
                    "body" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        body = Some(a);
                    }
                    "load_pattern" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        load_pattern = Some(a);
                    }
                    "method" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        method = Some(a);
                    }
                    "on_demand" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        on_demand = Some(a);
                    }
                    "peak_load" => {
                        let p =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        let p = PreHitsPer(p);
                        peak_load = Some(p);
                    }
                    "tags" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        tags = Some(a);
                    }
                    "url" => {
                        let v =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        url = Some(v);
                    }
                    "provides" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        provides = Some(a);
                    }
                    "logs" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        logs = Some(a);
                    }
                    "max_parallel_requests" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        max_parallel_requests = Some(a);
                    }
                    "no_auto_returns" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        no_auto_returns = Some(a);
                    }
                    "request_timeout" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        request_timeout = Some(a);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let declare = declare.unwrap_or_default();
        let headers = headers.unwrap_or_default();
        let method = method.unwrap_or_default();
        let on_demand = on_demand.unwrap_or_default();
        let tags = tags.unwrap_or_default();
        let url = url.ok_or_else(|| Error::MissingYamlField("url", marker))?;
        let provides = provides.unwrap_or_default();
        let logs = logs.unwrap_or_default();
        let no_auto_returns = no_auto_returns.unwrap_or_default();
        let ret = Self {
            declare,
            headers,
            body,
            load_pattern,
            method,
            on_demand,
            peak_load,
            tags,
            url,
            provides,
            logs,
            max_parallel_requests,
            no_auto_returns,
            request_timeout,
            marker,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
enum Body {
    String(PreTemplate),
    File(PreTemplate),
    Multipart(TupleVec<String, BodyMultipartPiece>),
}

impl FromYaml for Body {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.peek()?;
        match event {
            YamlEvent::Scalar(_, _, Some((_, tag))) if tag.as_str() == "file" => {
                let (file, marker) = FromYaml::parse(decoder)?;
                let value = (Body::File(file), marker);
                return Ok(value);
            }
            YamlEvent::Scalar(..) => {
                let (t, marker) = FromYaml::parse(decoder)?;
                let value = (Body::String(t), marker);
                return Ok(value);
            }
            YamlEvent::SequenceStart => {
                let (multipart, marker) = FromYaml::parse(decoder)?;
                let value = (Body::Multipart(multipart), marker);
                return Ok(value);
            }
            YamlEvent::MappingStart => {
                decoder.next()?;
            }
            _ => return Err(Error::YamlDeserialize(None, *marker)),
        }
        // untagged
        let (event, marker) = decoder.next()?;
        let ret = match event.into_string() {
            Ok(s) if s.as_str() == "file" => {
                let (file, marker) = FromYaml::parse(decoder)?;
                (Body::File(file), marker)
            }
            Ok(s) if s.as_str() == "multipart" => {
                let (multipart, marker) = FromYaml::parse(decoder)?;
                (Body::Multipart(multipart), marker)
            }
            Ok(s) => return Err(Error::UnrecognizedKey(s, None, marker)),
            Err(_) => return Err(Error::YamlDeserialize(None, marker)),
        };
        let (event, marker) = decoder.next()?;
        match event {
            YamlEvent::MappingEnd => (),
            _ => return Err(Error::YamlDeserialize(None, marker)),
        }
        Ok(ret)
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct BodyMultipartPiece {
    pub headers: TupleVec<String, PreTemplate>,
    pub body: BodyMultipartPieceBody,
}

impl FromYaml for BodyMultipartPiece {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut headers = None;
        let mut body = None;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "headers" => {
                        let c =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        headers = Some(c);
                    }
                    "body" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        body = Some(a);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let headers = headers.unwrap_or_default();
        let body = body.ok_or_else(|| Error::MissingYamlField("body", marker))?;
        let ret = Self { headers, body };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
enum BodyMultipartPieceBody {
    String(PreTemplate),
    File(PreTemplate),
}

impl FromYaml for BodyMultipartPieceBody {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.peek()?;
        match event {
            YamlEvent::Scalar(_, _, Some((_, tag))) if tag.as_str() == "file" => {
                let (file, marker) = FromYaml::parse(decoder)?;
                let value = (BodyMultipartPieceBody::File(file), marker);
                return Ok(value);
            }
            YamlEvent::Scalar(..) => {
                let (t, marker) = FromYaml::parse(decoder)?;
                let value = (BodyMultipartPieceBody::String(t), marker);
                return Ok(value);
            }
            YamlEvent::MappingStart => {
                decoder.next()?;
            }
            _ => return Err(Error::YamlDeserialize(None, *marker)),
        }
        // untagged
        let (event, marker) = decoder.next()?;
        let ret = match event.into_string() {
            Ok(s) if s.as_str() == "file" => {
                let (file, marker) = FromYaml::parse(decoder)?;
                (BodyMultipartPieceBody::File(file), marker)
            }
            Ok(s) => return Err(Error::UnrecognizedKey(s, None, marker)),
            Err(_) => return Err(Error::YamlDeserialize(None, marker)),
        };
        let (event, marker) = decoder.next()?;
        match event {
            YamlEvent::MappingEnd => (),
            _ => return Err(Error::YamlDeserialize(None, marker)),
        }
        Ok(ret)
    }
}

#[derive(Copy, Clone)]
#[cfg_attr(test, derive(Debug, PartialEq))]
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

impl FromYaml for EndpointProvidesSendOptions {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (event, marker) = decoder.next()?;
        if let Ok(s) = event.into_string() {
            let send = match s.as_ref() {
                "block" => EndpointProvidesSendOptions::Block,
                "force" => EndpointProvidesSendOptions::Force,
                "if_not_full" => EndpointProvidesSendOptions::IfNotFull,
                _ => return Err(Error::YamlDeserialize(None, marker)),
            };
            Ok((send, marker))
        } else {
            Err(Error::YamlDeserialize(None, marker))
        }
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
pub(crate) struct EndpointProvidesPreProcessed {
    send: Option<EndpointProvidesSendOptions>,
    select: WithMarker<json::Value>,
    for_each: Vec<WithMarker<String>>,
    where_clause: Option<WithMarker<String>>,
}

impl FromYaml for EndpointProvidesPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut send = None;
        let mut select = None;
        let mut for_each = None;
        let mut where_clause = None;
        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "send" => {
                        let r =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        send = Some(r);
                    }
                    "select" => {
                        let r =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        select = Some(r);
                    }
                    "for_each" => {
                        let r =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        for_each = Some(r);
                    }
                    "where" => {
                        let v =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        where_clause = Some(v);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let select = select.ok_or_else(|| Error::MissingYamlField("select", marker))?;
        let for_each = for_each.unwrap_or_default();
        let ret = Self {
            send,
            select,
            for_each,
            where_clause,
        };
        Ok((ret, marker))
    }
}

fn default_keepalive(marker: Marker) -> PreDuration {
    PreDuration(PreTemplate::new(WithMarker::new("90s".into(), marker)))
}

fn default_request_timeout(marker: Marker) -> PreDuration {
    PreDuration(PreTemplate::new(WithMarker::new("60s".into(), marker)))
}

fn default_bucket_size(marker: Marker) -> PreDuration {
    PreDuration(PreTemplate::new(WithMarker::new("60s".into(), marker)))
}

pub fn default_auto_buffer_start_size() -> usize {
    5
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct ClientConfigPreProcessed {
    request_timeout: PreDuration,
    headers: TupleVec<String, PreTemplate>,
    keepalive: PreDuration,
}

impl FromYaml for ClientConfigPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut request_timeout = None;
        let mut headers = None;
        let mut keepalive = None;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "request_timeout" => {
                        let c =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        request_timeout = Some(c);
                    }
                    "keepalive" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        keepalive = Some(a);
                    }
                    "headers" => {
                        let b =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        headers = Some(b);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let request_timeout = request_timeout.unwrap_or_else(|| default_request_timeout(marker));
        let keepalive = keepalive.unwrap_or_else(|| default_keepalive(marker));
        let headers = headers.unwrap_or_default();
        let ret = Self {
            request_timeout,
            keepalive,
            headers,
        };
        Ok((ret, marker))
    }
}

pub struct ClientConfig {
    pub request_timeout: Duration,
    pub keepalive: Duration,
}

impl DefaultWithMarker for ClientConfigPreProcessed {
    fn default(marker: Marker) -> Self {
        ClientConfigPreProcessed {
            request_timeout: default_request_timeout(marker),
            headers: Default::default(),
            keepalive: default_keepalive(marker),
        }
    }
}

pub struct GeneralConfig {
    pub auto_buffer_start_size: usize,
    pub bucket_size: Duration,
    pub log_provider_stats: Option<Duration>,
    pub watch_transition_time: Option<Duration>,
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct GeneralConfigPreProcessed {
    auto_buffer_start_size: usize,
    bucket_size: PreDuration,
    log_provider_stats: Option<PreDuration>,
    watch_transition_time: Option<PreDuration>,
}

impl DefaultWithMarker for GeneralConfigPreProcessed {
    fn default(marker: Marker) -> Self {
        GeneralConfigPreProcessed {
            auto_buffer_start_size: default_auto_buffer_start_size(),
            bucket_size: default_bucket_size(marker),
            log_provider_stats: None,
            watch_transition_time: None,
        }
    }
}

impl FromYaml for GeneralConfigPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut auto_buffer_start_size = default_auto_buffer_start_size();
        let mut bucket_size = None;
        let mut log_provider_stats = None;
        let mut watch_transition_time = None;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "auto_buffer_start_size" => {
                        let c =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        auto_buffer_start_size = c;
                    }
                    "bucket_size" => {
                        let a =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        bucket_size = Some(a);
                    }
                    "log_provider_stats" => {
                        let b =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        log_provider_stats = Some(b);
                    }
                    "watch_transition_time" => {
                        let b =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        watch_transition_time = Some(b);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let bucket_size = bucket_size.unwrap_or_else(|| default_bucket_size(marker));
        let ret = Self {
            auto_buffer_start_size,
            bucket_size,
            log_provider_stats,
            watch_transition_time,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
pub struct ConfigPreProcessed {
    client: ClientConfigPreProcessed,
    general: GeneralConfigPreProcessed,
}

impl DefaultWithMarker for ConfigPreProcessed {
    fn default(marker: Marker) -> Self {
        Self {
            client: DefaultWithMarker::default(marker),
            general: DefaultWithMarker::default(marker),
        }
    }
}

impl FromYaml for ConfigPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut client = None;
        let mut general = None;

        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "client" => {
                        let (c, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        client = Some(c);
                    }
                    "general" => {
                        let (a, _) =
                            FromYaml::parse(decoder).map_err(map_yaml_deserialize_err(s))?;
                        general = Some(a);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let client = client.unwrap_or_else(|| DefaultWithMarker::default(marker));
        let general = general.unwrap_or_else(|| DefaultWithMarker::default(marker));
        let ret = Self { client, general };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct LoadTestPreProcessed {
    config: ConfigPreProcessed,
    endpoints: Vec<EndpointPreProcessed>,
    load_pattern: Option<PreLoadPattern>,
    providers: BTreeMap<String, ProviderPreProcessed>,
    loggers: BTreeMap<String, LoggerPreProcessed>,
    vars: BTreeMap<String, PreVar>,
}

impl FromYaml for LoadTestPreProcessed {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let mut config = None;
        let mut endpoints = None;
        let mut load_pattern = None;
        let mut providers = None;
        let mut loggers = None;
        let mut vars = None;
        let mut first_marker = None;
        let mut saw_opening = false;
        loop {
            let (event, marker) = decoder.next()?;
            if first_marker.is_none() {
                first_marker = Some(marker);
            }
            match event {
                YamlEvent::MappingStart => {
                    if saw_opening {
                        return Err(Error::YamlDeserialize(None, marker));
                    } else {
                        saw_opening = true;
                    }
                }
                YamlEvent::SequenceStart => {
                    return Err(Error::YamlDeserialize(None, marker));
                }
                YamlEvent::MappingEnd => {
                    break;
                }
                YamlEvent::SequenceEnd => {
                    unreachable!("shouldn't see sequence end");
                }
                YamlEvent::Scalar(s, ..) => match s.as_str() {
                    "config" => {
                        let r =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        config = Some(r);
                    }
                    "endpoints" => {
                        let r =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        endpoints = Some(r);
                    }
                    "load_pattern" => {
                        let v =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        load_pattern = Some(v);
                    }
                    "providers" => {
                        let v =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        providers = Some(v);
                    }
                    "loggers" => {
                        let v =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        loggers = Some(v);
                    }
                    "vars" => {
                        let v =
                            FromYaml::parse_into(decoder).map_err(map_yaml_deserialize_err(s))?;
                        vars = Some(v);
                    }
                    _ => return Err(Error::UnrecognizedKey(s, None, marker)),
                },
            }
        }
        let marker = first_marker.expect("should have a marker");
        let config = config.unwrap_or_else(|| DefaultWithMarker::default(marker));
        let endpoints = endpoints.ok_or_else(|| Error::MissingYamlField("endpoints", marker))?;
        let providers = providers.unwrap_or_default();
        let loggers = loggers.unwrap_or_default();
        let vars = vars.unwrap_or_default();
        let ret = Self {
            config,
            endpoints,
            load_pattern,
            providers,
            loggers,
            vars,
        };
        Ok((ret, marker))
    }
}

#[cfg_attr(test, derive(Debug))]
struct WithMarker<T> {
    inner: T,
    marker: Marker,
}

#[cfg(test)]
impl<T: PartialEq> PartialEq for WithMarker<T> {
    fn eq(&self, other: &Self) -> bool {
        self.inner == other.inner
    }
}

impl<T> WithMarker<T> {
    fn new(inner: T, marker: Marker) -> Self {
        WithMarker { inner, marker }
    }

    fn destruct(self) -> (T, Marker) {
        (self.inner, self.marker)
    }

    fn inner(&self) -> &T {
        &self.inner
    }

    fn marker(&self) -> Marker {
        self.marker
    }
}

impl<T: FromYaml> FromYaml for WithMarker<T> {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (s, marker) = FromYaml::parse(decoder)?;
        Ok((Self { inner: s, marker }, marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct PreValueOrExpression(WithMarker<String>);

impl PreValueOrExpression {
    fn evaluate(
        &self,
        required_providers: &mut RequiredProviders,
        static_vars: &BTreeMap<String, json::Value>,
    ) -> Result<ValueOrExpression, Error> {
        ValueOrExpression::new(
            &self.0.inner,
            required_providers,
            static_vars,
            false,
            self.0.marker,
        )
        .map_err(Into::into)
    }
}

impl FromYaml for PreValueOrExpression {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (s, marker) = FromYaml::parse(decoder)?;
        Ok((PreValueOrExpression(s), marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct PreTemplate(WithMarker<String>, bool);

impl PreTemplate {
    fn new(w: WithMarker<String>) -> Self {
        PreTemplate(w, false)
    }

    fn no_fail(&mut self) {
        self.1 = true;
    }

    fn evaluate(
        &self,
        static_vars: &BTreeMap<String, json::Value>,
        required_providers: &mut RequiredProviders,
    ) -> Result<String, Error> {
        self.as_template(static_vars, required_providers)
            .and_then(|t| {
                t.evaluate(Cow::Owned(json::Value::Null), None)
                    .map_err(Into::into)
            })
    }

    fn as_template(
        &self,
        static_vars: &BTreeMap<String, json::Value>,
        required_providers: &mut RequiredProviders,
    ) -> Result<Template, Error> {
        Template::new(
            &self.0.inner,
            static_vars,
            required_providers,
            self.1,
            self.0.marker,
        )
        .map_err(Into::into)
    }
}

impl FromYaml for PreTemplate {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (s, marker) = FromYaml::parse(decoder)?;
        Ok((Self::new(s), marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
pub struct PreVar(WithMarker<json::Value>);

impl PreVar {
    fn evaluate(mut self, env_vars: &BTreeMap<String, json::Value>) -> Result<json::Value, Error> {
        fn json_transform(
            v: &mut json::Value,
            env_vars: &BTreeMap<String, json::Value>,
            marker: Marker,
        ) -> Result<(), Error> {
            match v {
                json::Value::String(s) => {
                    let t =
                        Template::new(s, env_vars, &mut RequiredProviders::new(), false, marker)
                            .map_err(Error::ExpressionErr)?;
                    let s = match t.evaluate(Cow::Owned(json::Value::Null), None) {
                        Ok(s) => s,
                        Err(ExpressionError::UnknownProvider(s, marker))
                        | Err(ExpressionError::IndexingIntoJson(s, _, marker)) => {
                            return Err(Error::MissingEnvironmentVariable(s, marker))
                        }
                        Err(e) => return Err(e.into()),
                    };
                    *v = json::from_str(&s).unwrap_or_else(|_e| json::Value::String(s));
                }
                json::Value::Array(a) => {
                    for v in a.iter_mut() {
                        json_transform(v, env_vars, marker)?;
                    }
                }
                json::Value::Object(o) => {
                    for v in o.values_mut() {
                        json_transform(v, env_vars, marker)?;
                    }
                }
                _ => (),
            }
            Ok(())
        }

        json_transform(&mut self.0.inner, env_vars, self.0.marker)?;
        Ok(self.0.inner)
    }
}

impl FromYaml for PreVar {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (patterns, marker) = FromYaml::parse(decoder)?;
        Ok((Self(patterns), marker))
    }
}

pub(crate) fn create_marker() -> Marker {
    Scanner::new("".chars()).mark()
}

pub fn duration_from_string(dur: String) -> Result<Duration, Error> {
    let marker = create_marker();
    duration_from_string2(dur, marker)
}

fn duration_from_string2(dur: String, marker: Marker) -> Result<Duration, Error> {
    let base_re = r"(?i)(\d+)\s*(d|h|m|s|days?|hrs?|mins?|secs?|hours?|minutes?|seconds?)";
    let sanity_re =
        Regex::new(&format!(r"^(?:{}\s*)+$", base_re)).expect("should be a valid regex");
    if !sanity_re.is_match(&dur) {
        return Err(Error::InvalidDuration(dur, marker));
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

#[cfg_attr(test, derive(Debug, PartialEq))]
pub struct PreDuration(PreTemplate);

impl PreDuration {
    fn evaluate(&self, static_vars: &BTreeMap<String, json::Value>) -> Result<Duration, Error> {
        let dur = self
            .0
            .evaluate(static_vars, &mut RequiredProviders::new())?;
        duration_from_string2(dur, (self.0).0.marker)
    }
}

impl FromYaml for PreDuration {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (p, marker) = FromYaml::parse(decoder)?;
        Ok((Self(p), marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct PrePercent(PreTemplate);

impl PrePercent {
    fn evaluate(&self, static_vars: &BTreeMap<String, json::Value>) -> Result<f64, Error> {
        let string = self
            .0
            .evaluate(static_vars, &mut RequiredProviders::new())?;
        let re = Regex::new(r"^(\d+(?:\.\d+)?)%$").expect("should be a valid regex");

        let captures = re
            .captures(&string)
            .ok_or_else(|| Error::InvalidPercent(string.clone(), ((self.0).0).marker))?;

        Ok(captures
            .get(1)
            .expect("should have capture group")
            .as_str()
            .parse()
            .expect("should be valid digits for percent"))
    }
}

impl FromYaml for PrePercent {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (p, marker) = FromYaml::parse(decoder)?;
        Ok((Self(p), marker))
    }
}

#[cfg_attr(test, derive(Debug))]
struct PreLoadPattern(Vec<LoadPatternPreProcessed>, Marker);

#[cfg(test)]
impl PartialEq for PreLoadPattern {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

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
            .ok_or_else(|| Error::InvalidLoadPattern(self.1))
            .map(LoadPattern::Linear)
    }
}

impl FromYaml for PreLoadPattern {
    fn parse<I: Iterator<Item = char>>(decoder: &mut YamlDecoder<I>) -> ParseResult<Self> {
        let (patterns, marker) = FromYaml::parse(decoder)?;
        Ok((Self(patterns, marker), marker))
    }
}

#[cfg_attr(test, derive(Debug, PartialEq))]
struct PreHitsPer(PreTemplate);

impl PreHitsPer {
    fn evaluate(&self, static_vars: &BTreeMap<String, json::Value>) -> Result<HitsPer, Error> {
        let string = self
            .0
            .evaluate(static_vars, &mut RequiredProviders::new())?;
        let re = Regex::new(r"^(?i)(\d+)\s*hp([ms])$").expect("should be a valid regex");
        let captures = re
            .captures(&string)
            .ok_or_else(|| Error::InvalidPeakLoad(string.clone(), (self.0).0.marker))?;
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
pub struct Config {
    pub client: ClientConfig,
    pub general: GeneralConfig,
}

pub struct LoadTest {
    pub config: Config,
    pub endpoints: Vec<Endpoint>,
    pub providers: BTreeMap<String, Provider>,
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
        let to = to.evaluate(vars, &mut RequiredProviders::new())?;
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
    pub request_timeout: Option<Duration>,
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
            request_timeout,
            mut tags,
            ..
        } = endpoint;
        let mut required_providers = RequiredProviders::new();

        let mut headers_to_remove = BTreeSet::new();
        let mut headers_to_add = Vec::new();
        for (k, v) in headers.0 {
            if let Nullable::Some(v) = v {
                let v = v.as_template(static_vars, &mut required_providers)?;
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
            .0
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

        let url_marker = (url.0).marker;
        let url = url.as_template(static_vars, &mut required_providers)?;
        tags.entry("url".into()).or_insert_with(|| {
            PreTemplate::new(WithMarker::new(url.evaluate_with_star(), url_marker))
        });
        tags.insert(
            "_id".into(),
            PreTemplate::new(WithMarker::new(endpoint_id.to_string(), url_marker)),
        );
        tags.insert(
            "method".into(),
            PreTemplate::new(WithMarker::new(method.to_string(), url_marker)),
        );
        let tags: BTreeMap<_, _> = tags
            .into_iter()
            .map(|(key, mut value)| {
                value.no_fail();
                let value = value.as_template(&static_vars, &mut required_providers)?;
                Ok((key, value))
            })
            .collect::<Result<_, Error>>()?;

        let body = body
            .map(|body| {
                let value = match body {
                    Body::File(body) => {
                        let template = body.as_template(static_vars, &mut required_providers)?;
                        BodyTemplate::File(config_path.clone(), template)
                    }
                    Body::String(body) => {
                        let template = body.as_template(static_vars, &mut required_providers)?;
                        BodyTemplate::String(template)
                    }
                    Body::Multipart(multipart) => {
                        let pieces = multipart
                            .0
                            .into_iter()
                            .map(|(name, v)| {
                                let (is_file, template) = match v.body {
                                    BodyMultipartPieceBody::File(t) => {
                                        let template =
                                            t.as_template(static_vars, &mut required_providers)?;
                                        (true, template)
                                    }
                                    BodyMultipartPieceBody::String(t) => {
                                        let template =
                                            t.as_template(static_vars, &mut required_providers)?;
                                        (false, template)
                                    }
                                };
                                let headers = v
                                    .headers
                                    .0
                                    .into_iter()
                                    .map(|(k, v)| {
                                        let template =
                                            v.as_template(static_vars, &mut required_providers)?;
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
            .map(|(key, expression)| {
                providers_to_stream.remove(&key);
                let value = expression.evaluate(&mut required_providers2, static_vars)?;
                Ok((key, value))
            })
            .collect::<Result<_, Error>>()?;
        required_providers2.extend(providers_to_stream.clone());
        let required_providers = required_providers2;
        let request_timeout = request_timeout
            .map(|d| d.evaluate(static_vars))
            .transpose()?;

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
            request_timeout,
            required_providers,
            url,
            tags,
        };

        for (key, value) in logs.0 {
            let value = EndpointProvidesPreProcessed {
                send: Some(EndpointProvidesSendOptions::Block),
                select: value.select,
                for_each: value.for_each,
                where_clause: value.where_clause,
            };
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
        let iter = std::str::from_utf8(bytes).unwrap().chars();

        let mut decoder = YamlDecoder::new(iter);

        let (c, _) = LoadTestPreProcessed::parse(&mut decoder)?;
        let env_vars = env_vars
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().into()))
            .collect();

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
            .0
            .iter()
            .map(|(key, value)| {
                let mut required_providers = RequiredProviders::new();
                let value = value.as_template(&vars, &mut required_providers)?;
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
        let mut endpoint_markers = Vec::new();
        let endpoints = c
            .endpoints
            .into_iter()
            .enumerate()
            .map(|(i, e)| {
                let marker = e.marker;
                endpoint_markers.push(marker);
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
                    let requires_response_provider = e.required_providers.iter().any(|(p, _)| {
                        providers
                            .get(p)
                            .map(ProviderPreProcessed::is_response_provider)
                            .unwrap_or_default()
                    });
                    let has_provides_send_block = e
                        .provides
                        .iter()
                        .any(|(_, v)| v.get_send_behavior().is_block());
                    if !has_provides_send_block && !requires_response_provider {
                        // endpoint should have a peak_load, have a provides which is send_block, or depend upon a response provider
                        load_test_errors.push(Error::MissingPeakLoad(marker));
                    }
                } else if e.load_pattern.is_none() {
                    // endpoint is missing a load_pattern
                    load_test_errors.push(Error::MissingLoadPattern(marker));
                }

                Ok(e)
            })
            .collect::<Result<_, Error>>()?;
        let providers = providers
            .into_iter()
            .map(|(key, value)| {
                let value = match value {
                    ProviderPreProcessed::File(f) => {
                        let FileProviderPreProcessed {
                            csv,
                            auto_return,
                            buffer,
                            format,
                            path,
                            random,
                            repeat,
                        } = f;
                        let path = path.evaluate(&vars, &mut RequiredProviders::new())?;
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
                    ProviderPreProcessed::Range(r) => Provider::Range(r.into()),
                    ProviderPreProcessed::Response(r) => Provider::Response(r),
                    ProviderPreProcessed::List(l) => Provider::List(l),
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
        for (e, marker) in loadtest.endpoints.iter().zip(endpoint_markers) {
            loadtest.verify_loggers(e.logs.iter().map(|(l, _)| (l, &marker)))?;
            let providers = e.provides.iter().map(|(k, _)| (k, &marker));
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

    fn verify_loggers<'a, I: Iterator<Item = (&'a String, &'a Marker)>>(
        &self,
        mut loggers: I,
    ) -> Result<(), Error> {
        if let Some((l, marker)) = loggers.find(|(l, _)| !self.loggers.contains_key(*l)) {
            Err(Error::UnknownLogger(l.clone(), *marker))
        } else {
            Ok(())
        }
    }

    fn verify_providers<'a, I: Iterator<Item = (&'a String, &'a Marker)>>(
        &self,
        mut providers: I,
    ) -> Result<(), Error> {
        if let Some((p, marker)) = providers.find(|(p, _)| !self.providers.contains_key(*p)) {
            let e = ExpressionError::UnknownProvider(p.clone(), *marker);
            Err(e.into())
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

#[cfg(test)]
mod tests {
    use super::*;
    use maplit::btreemap;

    fn check_all<T: FromYaml + std::fmt::Debug + PartialEq>(checks: Vec<(&str, Option<T>)>) {
        for (i, (s, n)) in checks.into_iter().enumerate() {
            let n2 = T::from_yaml_str(s);
            match (&n, &n2) {
                (None, _) => assert!(n2.is_err(), "failed at index {} with {:?}", i, n2),
                (Some(n), Ok(n2)) => assert_eq!(n2, n, "failed at index {}", i),
                _ => panic!("failed at index {} with `{:?}` and `{:?}`", i, n, n2),
            }
        }
    }

    #[test]
    fn from_yaml_method() {
        let values = vec![
            ("POST", Some(Method::POST)),
            ("GET", Some(Method::GET)),
            ("PUT", Some(Method::PUT)),
            ("HEAD", Some(Method::HEAD)),
            ("DELETE", Some(Method::DELETE)),
            ("OPTIONS", Some(Method::OPTIONS)),
            ("CONNECT", Some(Method::CONNECT)),
            ("PATCH", Some(Method::PATCH)),
            ("TRACE", Some(Method::TRACE)),
            ("GIT", None),
            ("7", None),
            ("get", None),
        ];
        check_all(values);
    }

    impl PartialEq for Limit {
        fn eq(&self, other: &Self) -> bool {
            match (self, other) {
                (Limit::Auto(_), Limit::Auto(_)) => self.get() == other.get(),
                (Limit::Integer(_), Limit::Integer(_)) => self.get() == other.get(),
                _ => false,
            }
        }
    }

    #[test]
    fn from_yaml_limit() {
        let values = vec![
            ("asdf", None),
            ("auto", Some(Limit::auto())),
            ("96", Some(Limit::Integer(96))),
            ("-96", None),
        ];
        check_all(values);
    }

    fn create_with_marker<T>(t: T) -> WithMarker<T> {
        WithMarker::new(t, create_marker())
    }

    fn create_marker() -> Marker {
        Scanner::new("".chars()).mark()
    }

    fn create_template(s: &str) -> PreTemplate {
        PreTemplate(create_with_marker(s.to_string()), false)
    }

    #[test]
    fn from_yaml_static_list() {
        let values = vec![
            (
                "values:
                    - foo
                    - bar",
                Some(StaticList::Explicit(ExplicitStaticList {
                    random: false,
                    repeat: true,
                    values: vec![json::json!("foo"), json::json!("bar")],
                })),
            ),
            (
                "
                repeat: false
                random: true
                values:
                    - foo
                    - bar",
                Some(StaticList::Explicit(ExplicitStaticList {
                    random: true,
                    repeat: false,
                    values: vec![json::json!("foo"), json::json!("bar")],
                })),
            ),
            (
                "
                - foo
                - bar",
                Some(StaticList::Implicit(vec![
                    json::json!("foo"),
                    json::json!("bar"),
                ])),
            ),
            (
                "
                foo: 123
                bar: 456",
                None,
            ),
            (
                "
                values:
                    foo: 123
                    bar: 456",
                None,
            ),
        ];
        check_all(values);
    }

    #[test]
    fn from_yaml_load_pattern_pre_processed() {
        let values = vec![
            ("asdf", None),
            (
                "
                linear:
                    to: 10%
                    over: 9h",
                Some(LoadPatternPreProcessed::Linear(LinearBuilderPreProcessed {
                    from: None,
                    to: PrePercent(create_template("10%")),
                    over: PreDuration(create_template("9h")),
                })),
            ),
            (
                "
                linear:
                    from: 50%
                    to: 10%
                    over: 9h",
                Some(LoadPatternPreProcessed::Linear(LinearBuilderPreProcessed {
                    from: Some(PrePercent(create_template("50%"))),
                    to: PrePercent(create_template("10%")),
                    over: PreDuration(create_template("9h")),
                })),
            ),
            (
                "
                linear:
                    from: 50%
                    to: 10%
                    over: 9h
                    foo: 123",
                None,
            ),
            ("-96", None),
        ];
        check_all(values);
    }

    #[test]
    fn from_yaml_provider_pre_processed() {
        let values = vec![
            ("asdf", None),
            (
                "
                file:
                    path: foo.bar",
                Some(ProviderPreProcessed::File(FileProviderPreProcessed {
                    csv: Default::default(),
                    auto_return: None,
                    buffer: Default::default(),
                    format: Default::default(),
                    path: create_template("foo.bar"),
                    random: false,
                    repeat: false,
                })),
            ),
            (
                "range: {}",
                Some(ProviderPreProcessed::Range(RangeProviderPreProcessed {
                    start: 0,
                    end: std::i64::MAX,
                    step: NonZeroU16::new(1).expect("1 is non-zero"),
                    repeat: false,
                })),
            ),
            (
                "response: {}",
                Some(ProviderPreProcessed::Response(ResponseProvider {
                    auto_return: None,
                    buffer: Default::default(),
                })),
            ),
            (
                "
                list:
                    - 1",
                Some(ProviderPreProcessed::List(StaticList::Implicit(vec![
                    json::json!(1),
                ]))),
            ),
        ];
        check_all(values);
    }

    fn create_endpoint_pre_processed(url: &str) -> EndpointPreProcessed {
        EndpointPreProcessed {
            declare: Default::default(),
            headers: Default::default(),
            body: None,
            load_pattern: None,
            method: Method::GET,
            on_demand: false,
            peak_load: None,
            tags: Default::default(),
            url: create_template(url),
            provides: Default::default(),
            logs: Default::default(),
            no_auto_returns: false,
            max_parallel_requests: None,
            request_timeout: None,
            marker: create_marker(),
        }
    }

    #[test]
    fn from_yaml_endpoint_pre_processed() {
        let values = vec![
            ("asdf", None),
            (
                "
                declare:
                    foo: bar
                headers:
                    foo: bar
                    baz: abc
                method: GET
                body: foo
                load_pattern:
                    - linear:
                        to: 100%
                        over: 10m
                on_demand: true
                peak_load: 50hps
                tags:
                    foo: bar
                url: http://localhost:8080/
                max_parallel_requests: 3
                provides:
                    foo:
                        select: 1
                    foo:
                        select: 1
                logs:
                    foo:
                        select: 1
                    foo:
                        select: 1
                no_auto_returns: true
                request_timeout: 15s",
                Some(EndpointPreProcessed {
                    declare: btreemap! {
                        "foo".to_string() => PreValueOrExpression(create_with_marker("bar".to_string()))
                    },
                    headers: vec![
                        ("foo".to_string(), Nullable::Some(create_template("bar"))),
                        ("baz".to_string(), Nullable::Some(create_template("abc"))),
                    ]
                    .into(),
                    body: Some(Body::String(create_template("foo"))),
                    load_pattern: Some(PreLoadPattern(
                        vec![LoadPatternPreProcessed::Linear(LinearBuilderPreProcessed {
                            from: None,
                            to: PrePercent(create_template("100%")),
                            over: PreDuration(create_template("10m")),
                        })],
                        create_marker(),
                    )),
                    method: Method::GET,
                    on_demand: true,
                    peak_load: Some(PreHitsPer(create_template("50hps"))),
                    tags: btreemap! {
                        "foo".to_string() => create_template("bar"),
                    },
                    url: create_template("http://localhost:8080/"),
                    provides: vec![
                        (
                            "foo".to_string(),
                            EndpointProvidesPreProcessed {
                                send: None,
                                select: create_with_marker(json::json!(1)),
                                for_each: Default::default(),
                                where_clause: None,
                            },
                        ),
                        (
                            "foo".to_string(),
                            EndpointProvidesPreProcessed {
                                send: None,
                                select: create_with_marker(json::json!(1)),
                                for_each: Default::default(),
                                where_clause: None,
                            },
                        ),
                    ]
                    .into(),
                    logs: vec![
                        (
                            "foo".to_string(),
                            LogsPreProcessed {
                                select: create_with_marker(json::json!(1)),
                                for_each: Default::default(),
                                where_clause: None,
                            },
                        ),
                        (
                            "foo".to_string(),
                            LogsPreProcessed {
                                select: create_with_marker(json::json!(1)),
                                for_each: Default::default(),
                                where_clause: None,
                            },
                        ),
                    ]
                    .into(),
                    no_auto_returns: true,
                    max_parallel_requests: Some(NonZeroUsize::new(3).unwrap()),
                    request_timeout: Some(PreDuration(create_template("15s"))),
                    marker: create_marker(),
                }),
            ),
            (
                "url: http://localhost:8080/",
                Some(create_endpoint_pre_processed("http://localhost:8080/")),
            ),
            ("method: GET", None),
        ];
        check_all(values);
    }

    #[test]
    fn from_yaml_body() {
        let values = vec![
            ("asdf", Some(Body::String(create_template("asdf")))),
            (
                "file: foo.bar",
                Some(Body::File(create_template("foo.bar"))),
            ),
            (
                "!file foo.bar",
                Some(Body::File(create_template("foo.bar"))),
            ),
            (
                "multipart:
                    foo: 
                        headers:
                            asdf: jkl
                        body: blah",
                Some(Body::Multipart(
                    vec![(
                        "foo".to_string(),
                        BodyMultipartPiece {
                            headers: vec![("asdf".to_string(), create_template("jkl"))].into(),
                            body: BodyMultipartPieceBody::String(create_template("blah")),
                        },
                    )]
                    .into(),
                )),
            ),
        ];
        check_all(values);
    }

    #[test]
    fn from_yaml_endpoints_provides_pre_processed() {
        let values = vec![
            ("asdf", None),
            (
                "
                select: foo
                send: block
                for_each:
                    - foo
                where: bar",
                Some(EndpointProvidesPreProcessed {
                    send: Some(EndpointProvidesSendOptions::Block),
                    for_each: vec![create_with_marker("foo".to_string())],
                    select: create_with_marker(json::json!("foo")),
                    where_clause: Some(create_with_marker("bar".to_string())),
                }),
            ),
            (
                "
                send: block
                for_each:
                    - foo
                where: bar",
                None,
            ),
            (
                "select:
                    foo: bar
                    baz: abc",
                Some(EndpointProvidesPreProcessed {
                    send: None,
                    for_each: Default::default(),
                    select: create_with_marker(json::json!({"foo": "bar", "baz": "abc"})),
                    where_clause: None,
                }),
            ),
        ];
        check_all(values);
    }

    #[test]
    fn from_yaml_endpoints_provides_send_options() {
        let values = vec![
            ("asdf", None),
            ("block", Some(EndpointProvidesSendOptions::Block)),
            ("if_not_full", Some(EndpointProvidesSendOptions::IfNotFull)),
            ("force", Some(EndpointProvidesSendOptions::Force)),
            (
                "if:
                    not: full",
                None,
            ),
        ];
        check_all(values);
    }

    #[test]
    fn from_yaml_client_config_pre_processed() {
        let values = vec![
            ("asdf", None),
            (
                "{}",
                Some(ClientConfigPreProcessed::default(create_marker())),
            ),
            (
                "request_timeout: 10s",
                Some(ClientConfigPreProcessed {
                    request_timeout: PreDuration(create_template("10s")),
                    ..DefaultWithMarker::default(create_marker())
                }),
            ),
            (
                "headers:
                    foo: bar
                    baz: 123",
                Some(ClientConfigPreProcessed {
                    headers: vec![
                        ("foo".to_string(), create_template("bar")),
                        ("baz".to_string(), create_template("123")),
                    ]
                    .into(),
                    ..DefaultWithMarker::default(create_marker())
                }),
            ),
        ];
        check_all(values);
    }

    #[test]
    fn from_yaml_general_config_pre_processed() {
        let values = vec![
            ("asdf", None),
            (
                "{}",
                Some(GeneralConfigPreProcessed::default(create_marker())),
            ),
        ];
        check_all(values);
    }

    #[test]
    fn from_yaml_load_test_pre_processed() {
        let values = vec![
            ("asdf", None),
            (
                "endpoints:
                    - url: http://localhost:8080",
                Some(LoadTestPreProcessed {
                    config: DefaultWithMarker::default(create_marker()),
                    providers: Default::default(),
                    load_pattern: None,
                    loggers: Default::default(),
                    vars: Default::default(),
                    endpoints: vec![create_endpoint_pre_processed("http://localhost:8080")],
                }),
            ),
            ("config: {}", None),
        ];
        check_all(values);
    }

    #[test]
    fn from_yaml_config_pre_processed() {
        let values = vec![
            ("asdf", None),
            ("{}", Some(ConfigPreProcessed::default(create_marker()))),
            (
                "general:
                    auto_buffer_start_size: 37",
                Some(ConfigPreProcessed {
                    client: DefaultWithMarker::default(create_marker()),
                    general: GeneralConfigPreProcessed {
                        auto_buffer_start_size: 37,
                        ..DefaultWithMarker::default(create_marker())
                    },
                }),
            ),
        ];
        check_all(values);
    }
}
