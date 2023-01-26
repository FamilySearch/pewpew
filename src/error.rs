use hyper::http::Error as HttpError;

use std::{error::Error as StdError, fmt, path::PathBuf, sync::Arc, time::SystemTime};

// An error that can happen in normal execution of an endpoint, but should not halt the test
#[derive(Clone, Debug)]
pub enum RecoverableError {
    ProviderDelay(String),
    BodyErr(Arc<dyn StdError + Send + Sync>),
    ConnectionErr(SystemTime, Arc<dyn StdError + Send + Sync>),
    ExecutingExpression(Box<config::ExecutingExpressionError>),
    Timeout(SystemTime),
}

use RecoverableError::*;

impl RecoverableError {
    pub fn code(&self) -> u32 {
        match self {
            BodyErr(_) => 1,
            ConnectionErr(..) => 2,
            ExecutingExpression(..) => 3,
            Timeout(_) => 4,
            ProviderDelay(_) => 5,
        }
    }
}

impl fmt::Display for RecoverableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BodyErr(e) => write!(f, "body error: {e}"),
            ConnectionErr(_, e) => write!(f, "connection error: `{e}`"),
            ExecutingExpression(e) => e.fmt(f),
            ProviderDelay(p) => write!(f, "endpoint was delayed waiting for provider `{p}`"),
            Timeout(..) => write!(f, "request timed out"),
        }
    }
}

// The types of errors that we may encounter during a test
#[derive(Clone, Debug)]
pub enum TestError {
    CannotCreateLoggerFile(String, Arc<std::io::Error>),
    CannotCreateStatsFile(String, Arc<std::io::Error>),
    CannotOpenFile(PathBuf, Arc<std::io::Error>),
    Config(Box<config::Error>),
    FileReading(String, Arc<std::io::Error>),
    InvalidConfigFilePath(PathBuf),
    InvalidUrl(String),
    Recoverable(RecoverableError),
    RequestBuilderErr(Arc<HttpError>),
    SslError(Arc<native_tls::Error>),
    WritingToFile(String, Arc<std::io::Error>),
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
            CannotCreateLoggerFile(s, e) => write!(f, "error creating logger file `{s}`: {e}"),
            CannotCreateStatsFile(s, e) => write!(f, "error creating stats file `{s}`: {e}"),
            CannotOpenFile(p, e) => write!(f, "error opening file `{}`: {}", p.display(), e),
            Config(e) => e.fmt(f),
            FileReading(s, e) => write!(f, "error reading file `{s}`: {e}"),
            InvalidConfigFilePath(p) => {
                write!(f, "could not find config file at path `{}`", p.display())
            }
            InvalidUrl(u) => write!(f, "invalid url `{u}`"),
            Recoverable(r) => write!(f, "recoverable error: {r}"),
            RequestBuilderErr(e) => write!(f, "error creating request: {e}"),
            SslError(e) => write!(f, "error creating ssl connector: {e}"),
            WritingToFile(l, e) => write!(f, "error writing to file `{l}`: {e}"),
        }
    }
}

impl StdError for TestError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            CannotCreateLoggerFile(_, e) => Some(&**e),
            CannotCreateStatsFile(_, e) => Some(&**e),
            CannotOpenFile(_, e) => Some(&**e),
            Config(e) => Some(e),
            FileReading(_, e) => Some(&**e),
            Recoverable(BodyErr(e)) => Some(&**e),
            Recoverable(ConnectionErr(_, e)) => Some(&**e),
            RequestBuilderErr(e) => Some(&**e),
            SslError(e) => Some(&**e),
            WritingToFile(_, e) => Some(&**e),
            _ => None,
        }
    }
}

impl From<config::Error> for TestError {
    fn from(ce: config::Error) -> Self {
        if let config::Error::ExpressionErr(config::CreatingExpressionError::Executing(
            e @ config::ExecutingExpressionError::IndexingIntoJson(..),
        )) = ce
        {
            Recoverable(ExecutingExpression(e.into()))
        } else {
            Config(ce.into())
        }
    }
}

impl From<config::CreatingExpressionError> for TestError {
    fn from(ce: config::CreatingExpressionError) -> Self {
        Config(Box::new(ce.into()))
    }
}

impl From<config::ExecutingExpressionError> for TestError {
    fn from(e: config::ExecutingExpressionError) -> Self {
        Config(Box::new(e.into()))
    }
}

impl From<config::ExecutingExpressionError> for RecoverableError {
    fn from(e: config::ExecutingExpressionError) -> Self {
        ExecutingExpression(Box::new(e))
    }
}

impl From<native_tls::Error> for TestError {
    fn from(te: native_tls::Error) -> Self {
        SslError(te.into())
    }
}
