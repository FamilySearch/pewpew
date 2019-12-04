use std::{error::Error as StdError, fmt};

use serde_json as json;
use yaml_rust::scanner::{Marker, ScanError};

type PestError = pest::error::Error<crate::select_parser::Rule>;

#[derive(Clone, Debug)]
pub enum ExpressionError {
    IndexingIntoJson(String, json::Value, Marker),
    InvalidExpression(PestError, Marker),
    InvalidFunctionArguments(&'static str, Marker),
    UnknownFunction(String, Marker),
    UnknownProvider(String, Marker),
}

impl ExpressionError {
    fn marker(&self) -> Marker {
        match self {
            IndexingIntoJson(_, _, marker) => *marker,
            InvalidExpression(_, marker) => *marker,
            InvalidFunctionArguments(_, marker) => *marker,
            UnknownFunction(_, marker) => *marker,
            UnknownProvider(_, marker) => *marker,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Error {
    ExpressionErr(ExpressionError),
    InvalidDuration(String, Marker),
    InvalidLoadPattern(Marker),
    InvalidPeakLoad(String, Marker),
    InvalidPercent(String, Marker),
    InvalidYaml(ScanError),
    MissingEnvironmentVariable(String, Marker),
    MissingForEach(Marker),
    MissingPeakLoad(Marker),
    MissingLoadPattern(Marker),
    MissingYamlField(&'static str, Marker),
    RecursiveForEachReference(Marker),
    UnknownLogger(String, Marker),
    UnrecognizedKey(String, Option<String>, Marker),
    YamlDeserialize(Option<String>, Marker),
}

impl Error {
    // fn marker(&self) -> Marker {
    //     match &self {
    //         ExpressionErr(e) => e.marker(),
    //         InvalidDuration(_, marker) => *marker,
    //         InvalidLoadPattern(marker) => *marker,
    //         InvalidPeakLoad(_, marker) => *marker,
    //         InvalidPercent(_, marker) => *marker,
    //         InvalidYaml(e) => *e.marker(),
    //         MissingEnvironmentVariable(_, marker) => *marker,
    //         MissingForEach(marker) => *marker,
    //         MissingPeakLoad(marker) => *marker,
    //         MissingLoadPattern(marker) => *marker,
    //         MissingYamlField(_, marker) => *marker,
    //         RecursiveForEachReference(marker) => *marker,
    //         UnknownLogger(_, marker) => *marker,
    //         UnrecognizedKey(_, _, marker) => *marker,
    //         YamlDeserialize(_, marker) => *marker,
    //     }
    // }
}

use Error::*;
use ExpressionError::*;

impl fmt::Display for ExpressionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InvalidExpression(e, _) => write!(f, "invalid expression. {:?}", e),
            IndexingIntoJson(p, ..) => write!(f, "indexing into json. Path was `{}`", p),
            InvalidFunctionArguments(func, _) => {
                write!(f, "invalid arguments for function `{}`", func)
            }
            UnknownFunction(func, _) => write!(f, "unknown function `{}`", func),
            UnknownProvider(p, _) => write!(f, "unknown provider: `{}`", p),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExpressionErr(e) => {
                let m = e.marker();
                write!(f, "{:?} at line {} column {}", e, m.line(), m.col())
            },
            InvalidDuration(d, m) => write!(f, "invalid duration `{}` at line {} column {}", d, m.line(), m.col()),
            InvalidLoadPattern(m) => write!(f, "invalid load_pattern at line {} column {}", m.line(), m.col()),
            InvalidPeakLoad(p, m) => write!(f, "invalid peak_load `{}` at line {} column {}", p, m.line(), m.col()),
            InvalidPercent(p, m) => write!(f, "invalid percent `{}` at line {} column {}", p, m.line(), m.col()),
            InvalidYaml(e) => write!(f, "yaml syntax error:\n\t{}", e),
            MissingEnvironmentVariable(v, m) => write!(f, "undefined environment variable `{}` at line {} column {}", v, m.line(), m.col()),
            MissingForEach(m) => write!(f, "missing `for_each` at line {} column {}", m.line(), m.col()),
            MissingLoadPattern(m) => write!(f, "endpoint is missing a load_pattern at line {} column {}", m.line(), m.col()),
            MissingPeakLoad(m) => write!(
                f,
                "endpoint must either have a `peak_load`, a provides which is `send: block`, or depend on a `response` provider. See line {} column {}", m.line(), m.col()
            ),
            MissingYamlField(field, m) => write!(f, "missing field `{}` at line {} column {}", field, m.line(), m.col()),
            RecursiveForEachReference(m) => write!(f, "recursive `for_each` reference at line {} column {}", m.line(), m.col()),
            UnknownLogger(l, m) => write!(f, "unknown logger `{}` at line {} column {}", l, m.line(), m.col()),
            UnrecognizedKey(k, Some(name), m) => write!(f, "unrecognized key `{}` in `{}` at line {} column {}", k, name, m.line(), m.col()),
            UnrecognizedKey(k, None, m) => write!(f, "unrecognized key `{}` at line {} column {}", k, m.line(), m.col()),
            YamlDeserialize(Some(name), m) => write!(f, "unexpected value for `{}` at line {} column {}", name, m.line(), m.col()),
            YamlDeserialize(None, m) => write!(f, "unexpected value for field at line {} column {}", m.line(), m.col()),
        }
    }
}

impl StdError for ExpressionError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            InvalidExpression(e, _) => Some(e),
            _ => None,
        }
    }
}

impl StdError for Error {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            ExpressionErr(e) => Some(e),
            InvalidYaml(e) => Some(e),
            _ => None,
        }
    }
}

impl From<ExpressionError> for Error {
    fn from(ee: ExpressionError) -> Self {
        ExpressionErr(ee)
    }
}

impl From<ScanError> for Error {
    fn from(se: ScanError) -> Self {
        InvalidYaml(se)
    }
}
