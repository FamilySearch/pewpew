use crate::config;

use hyper::http::Error as HttpError;
use pest::error::Error as PestError;
use serde_json as json;
use serde_yaml as yaml;

use std::{error::Error as StdError, fmt, path::PathBuf, sync::Arc, time::SystemTime};

#[derive(Clone, Debug)]
pub enum TestError {
    BodyErr(Arc<StdError + Send + Sync>),
    ConnectionErr(SystemTime, Arc<StdError + Send + Sync>),
    IndexingJson(String, json::Value),
    Internal(String),
    InvalidArguments(String),
    InvalidConfigFilePath(PathBuf),
    InvalidEncoding(String),
    InvalidFunction(String),
    InvalidJsonPathQuery(String),
    InvalidStatsIdReference(String),
    InvalidUrl(String),
    KilledByLogger,
    Other(String),
    PestParseErr(PestError<config::ParserRule>),
    ProviderEnded(Option<String>),
    RecursiveForEachReference,
    RequestBuilderErr(Arc<HttpError>),
    RegexErr(regex::Error),
    Timeout(SystemTime),
    TimeSkew,
    UnknownLogger(String),
    UnknownProvider(String),
    YamlDeserializerErr(Arc<yaml::Error>),
}

use TestError::*;

impl fmt::Display for TestError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            BodyErr(e) => write!(f, "body error: {}", e),
            ConnectionErr(_, e) => write!(f, "connection error: `{}`", e),
            IndexingJson(p, v) => write!(f, "indexing into json. Path was `{}`, json was: `{}`", p, v),
            Internal(m) => write!(f, "internal error: {}", m),
            InvalidArguments(func) => {
                write!(f, "invalid arguments for function {}", func)
            }
            InvalidConfigFilePath(p) => write!(
                f,
                "could not find config file at path `{}`",
                p.display()
            ),
            InvalidEncoding(e) => write!(f, "invalid encoding specified `{}`", e),
            InvalidFunction(func) => write!(f, "invalid function specified `{}`", func),
            InvalidJsonPathQuery(q) => write!(f, "invalid json path query: `{}`", q),
            InvalidStatsIdReference(r) => write!(f, "stats_id can only reference static providers and environment variables. Found `{}`", r),
            InvalidUrl(u) => write!(f, "invalid url `{}`", u),
            KilledByLogger => write!(f, "killed by logger"),
            Other(s) => write!(f, "{}", s),
            PestParseErr(err) => write!(f, "parsing expression: `{}`", err),
            ProviderEnded(p) => write!(
                f,
                "provider `{}` unexpectedly ended",
                p.as_ref().map(|p| p.as_str()).unwrap_or("unknown")
            ),
            RecursiveForEachReference => write!(
                f,
                "cannot reference 'for_each' within a for_each expression"
            ),
            RequestBuilderErr(e) => write!(
                f,
                "error while building request: {}",
                e
            ),
            RegexErr(err) => write!(f, "invalid regex: {}", err),
            Timeout(_) => write!(f, "request timed out"),
            TimeSkew => write!(f, "system clock experienced time skew"),
            UnknownProvider(p) => write!(f, "unknown provider `{}`", p),
            UnknownLogger(l) => write!(f, "unknown logger `{}`", l),
            YamlDeserializerErr(e) => write!(f, "error parsing yaml: {}", e),
        }
    }
}

impl StdError for TestError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            BodyErr(e) => Some(&**e),
            ConnectionErr(_, e) => Some(&**e),
            PestParseErr(e) => Some(e),
            RegexErr(e) => Some(e),
            RequestBuilderErr(e) => Some(&**e),
            YamlDeserializerErr(e) => Some(&**e),
            _ => None,
        }
    }
}

impl From<PestError<config::ParserRule>> for TestError {
    fn from(pe: PestError<config::ParserRule>) -> Self {
        TestError::PestParseErr(pe)
    }
}

impl From<yaml::Error> for TestError {
    fn from(ye: yaml::Error) -> Self {
        TestError::YamlDeserializerErr(ye.into())
    }
}

impl From<tokio::timer::Error> for TestError {
    fn from(te: tokio::timer::Error) -> Self {
        TestError::Internal(format!("{}", te))
    }
}
