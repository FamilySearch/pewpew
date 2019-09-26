use std::{error::Error as StdError, fmt, sync::Arc};

use serde_json as json;

type PestError = pest::error::Error<crate::select_parser::Rule>;

#[derive(Clone, Debug)]
pub enum Error {
    IndexingIntoJson(String, json::Value),
    InvalidDuration(String),
    InvalidExpression(PestError),
    InvalidFunctionArguments(&'static str),
    InvalidLoadPattern,
    InvalidPeakLoad(String),
    InvalidPercent(String),
    InvalidYaml(Arc<serde_yaml::Error>),
    MissingPeakLoad,
    MissingLoadPattern,
    RecursiveForEachReference,
    UnknownExpressionFunction(String),
    UnknownLogger(String),
    UnknownProvider(String),
}

use Error::*;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IndexingIntoJson(p, _) => write!(f, "indexing into json. Path was `{}`", p),
            InvalidDuration(d) => write!(f, "invalid duration `{}`", d),
            InvalidExpression(e) => write!(f, "invalid expression:\n\t{}", e),
            InvalidFunctionArguments(func) => {
                write!(f, "invalid arguments for function `{}`", func)
            }
            InvalidLoadPattern => write!(f, "invalid load_pattern"),
            InvalidPeakLoad(p) => write!(f, "invalid peak_load `{}`", p),
            InvalidPercent(p) => write!(f, "invalid percent `{}`", p),
            InvalidYaml(e) => write!(f, "yaml syntax error:\n\t{}", e),
            MissingPeakLoad => write!(
                f,
                "endpoint must either have a `peak_load`, a provides which is `send: block`, or depend on a `response` provider"
            ),
            MissingLoadPattern => write!(f, "endpoint is missing a load_pattern"),
            RecursiveForEachReference => write!(
                f,
                "cannot reference `for_each` within a `for_each` expression"
            ),
            UnknownExpressionFunction(func) => write!(f, "unknown function `{}`", func),
            UnknownLogger(l) => write!(f, "unknown logger `{}`", l),
            UnknownProvider(p) => write!(f, "unknown provider: `{}`", p),
        }
    }
}

impl StdError for Error {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            InvalidExpression(e) => Some(e),
            InvalidYaml(e) => Some(&**e),
            _ => None,
        }
    }
}

impl From<PestError> for Error {
    fn from(pe: PestError) -> Self {
        Error::InvalidExpression(pe)
    }
}
