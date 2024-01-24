use config::{self, error::EvalExprError};
use hyper::http::Error as HttpError;
use std::{error::Error as StdError, path::Path, sync::Arc, time::SystemTime};
use thiserror::Error;

// An error that can happen in normal execution of an endpoint, but should not halt the test
#[derive(Clone, Debug, Error)]
pub enum RecoverableError {
    #[error("endpoint was delayed waiting for provider {0}")]
    ProviderDelay(Arc<str>),
    #[error("body error: {0}")]
    BodyErr(#[source] Arc<dyn StdError + Send + Sync>),
    #[error("connection error: {1}")]
    ConnectionErr(SystemTime, #[source] Arc<dyn StdError + Send + Sync>),
    #[error("{0}")]
    ExecutingExpression(#[from] Box<config::error::EvalExprError>),
    #[error("request timed out")]
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

// The types of errors that we may encounter during a test
#[derive(Clone, Debug, Error)]
pub enum TestError {
    #[error("error creating logger file `{0}`: {1}")]
    CannotCreateLoggerFile(Arc<str>, #[source] Arc<std::io::Error>),
    #[error("error creating stats file `{0}`: {1}")]
    CannotCreateStatsFile(String, #[source] Arc<std::io::Error>),
    #[error("error opening file `{}`: {}", .0.display(), .1)]
    CannotOpenFile(Arc<Path>, #[source] Arc<std::io::Error>),
    #[error(transparent)]
    Config(#[from] Box<config::error::LoadTestGenError>),
    #[error("error reading file `{0}`: {1}")]
    FileReading(String, #[source] Arc<std::io::Error>),
    #[error("could not find config file at path `{}`", .0.display())]
    InvalidConfigFilePath(Arc<Path>),
    #[error("invalid url `{0}`")]
    InvalidUrl(String),
    #[allow(clippy::enum_variant_names)]
    #[error("invalid config for full test: {0}")]
    LoadTestError(#[from] config::error::InvalidForLoadTest),
    #[error("recoverable error: {0}")]
    Recoverable(#[from] RecoverableError),
    #[error("error creating request: {0}")]
    RequestBuilderErr(#[source] Arc<HttpError>),
    #[error("error creating ssl connector: `{0}`")]
    SslError(#[from] Arc<native_tls::Error>),
    #[error("error writing to file `{0}`: {1}")]
    WritingToFile(String, #[source] Arc<std::io::Error>),
}

impl From<EvalExprError> for TestError {
    fn from(value: EvalExprError) -> Self {
        RecoverableError::from(Box::new(value)).into()
    }
}

impl From<native_tls::Error> for TestError {
    fn from(te: native_tls::Error) -> Self {
        Self::SslError(te.into())
    }
}
