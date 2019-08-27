use crate::config;

use hyper::http::Error as HttpError;
use pest::error::Error as PestError;
use serde_json as json;
use serde_yaml as yaml;

use std::{borrow::Cow, error::Error as StdError, fmt, path::PathBuf, sync::Arc, time::SystemTime};

#[derive(Clone, Debug)]
pub enum RecoverableError {
    BodyErr(Arc<dyn StdError + Send + Sync>),
    ConnectionErr(SystemTime, Arc<dyn StdError + Send + Sync>),
    IndexingJson(String, json::Value),
    Timeout(SystemTime),
}

use RecoverableError::*;

impl RecoverableError {
    pub fn code(&self) -> u32 {
        match self {
            BodyErr(_) => 1,
            ConnectionErr(..) => 2,
            IndexingJson(..) => 3,
            Timeout(_) => 4,
        }
    }
}

impl fmt::Display for RecoverableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BodyErr(e) => write!(f, "body error: {}", e),
            ConnectionErr(_, e) => write!(f, "connection error: `{}`", e),
            IndexingJson(p, _) => write!(f, "indexing into json. Path was `{}`", p),
            Timeout(..) => write!(f, "request timed out"),
        }
    }
}

#[derive(Clone, Debug)]
pub enum TestError {
    Internal(Cow<'static, str>),
    InvalidArguments(String),
    InvalidConfigFilePath(PathBuf),
    InvalidEncoding(String),
    InvalidFunction(String),
    InvalidJsonPathQuery(String),
    InvalidUrl(String),
    Other(Cow<'static, str>),
    PestParseErr(PestError<config::ParserRule>),
    Recoverable(RecoverableError),
    RecursiveForEachReference,
    RequestBuilderErr(Arc<HttpError>),
    RegexErr(regex::Error),
    TimeSkew,
    UnknownLogger(String),
    UnknownProvider(String),
    YamlDeserializerErr(Arc<yaml::Error>),
}

impl From<RecoverableError> for TestError {
    fn from(re: RecoverableError) -> Self {
        TestError::Recoverable(re)
    }
}

use TestError::*;

impl fmt::Display for TestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Internal(m) => write!(f, "internal error: {}", m),
            InvalidArguments(func) => write!(f, "invalid arguments for function {}", func),
            InvalidConfigFilePath(p) => {
                write!(f, "could not find config file at path `{}`", p.display())
            }
            InvalidEncoding(e) => write!(f, "invalid encoding specified `{}`", e),
            InvalidFunction(func) => write!(f, "invalid function specified `{}`", func),
            InvalidJsonPathQuery(q) => write!(f, "invalid json path query: `{}`", q),
            InvalidUrl(u) => write!(f, "invalid url `{}`", u),
            Other(s) => write!(f, "{}", s),
            PestParseErr(err) => write!(f, "could not parse expression:\n{}", err),
            Recoverable(r) => write!(f, "{}", r),
            RecursiveForEachReference => write!(
                f,
                "cannot reference 'for_each' within a for_each expression"
            ),
            RequestBuilderErr(e) => write!(f, "error while building request: {}", e),
            RegexErr(err) => write!(f, "invalid regex: {}", err),
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
            PestParseErr(e) => Some(e),
            Recoverable(BodyErr(e)) => Some(&**e),
            Recoverable(ConnectionErr(_, e)) => Some(&**e),
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
        TestError::Internal(format!("{}", te).into())
    }
}

impl<T: fmt::Display> From<tokio::timer::timeout::Error<T>> for TestError {
    fn from(te: tokio::timer::timeout::Error<T>) -> Self {
        TestError::Internal(format!("{}", te).into())
    }
}
