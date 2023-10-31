use boa_engine::{syntax::parser::ParseError, JsValue};
use std::{error::Error as SError, io, sync::Arc};
use thiserror::Error;

#[derive(Debug, Error, Clone)]
pub enum LoadTestGenError {
    #[error("error parsing yaml: {0}")]
    YamlParse(#[from] Arc<serde_yaml::Error>),
    #[error("{0}")]
    Envs(#[from] EnvsError),
    #[error("error inserting static vars: {0}")]
    VarsError(#[from] VarsError),
    #[error("error loading external js: {0}")]
    LibLoad(#[from] Arc<io::Error>),
    #[error("endpoints are required")]
    NoEndpoints(),
    #[error("error missing providers: {0:?}")]
    MissingProviders(Vec<Arc<str>>),
    // Used by the config-wasm when only passing back a V1 error
    #[error("error {0}")]
    OtherErr(String),
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum InvalidForLoadTest {
    #[error("endpoints {0:?} are missing load patterns")]
    MissingLoadPattern(Vec<usize>),
    #[error("endpoints {0:?} are missing a required peak load")]
    MissingPeakLoad(Vec<usize>),
}

impl From<serde_yaml::Error> for LoadTestGenError {
    fn from(value: serde_yaml::Error) -> Self {
        Arc::new(value).into()
    }
}

impl From<io::Error> for LoadTestGenError {
    fn from(value: io::Error) -> Self {
        Arc::new(value).into()
    }
}

#[derive(Debug, Error, Clone)]
pub enum EnvsError {
    #[error(transparent)]
    MissingVar(#[from] MissingEnvVar),
    #[error(transparent)]
    EvalExpr(#[from] EvalExprError),
}

#[derive(Debug, Error, Clone)]
#[error("missing environment variable {0}")]
pub struct MissingEnvVar(pub(crate) String);

#[derive(Debug, Error, Clone)]
pub enum VarsError {
    #[error("var at path \"{0}\" not found")]
    VarNotFound(String),
    #[error("resulting string \"{from}\", was not a valid {typename} ({error})")]
    InvalidString {
        typename: &'static str,
        from: String,
        #[source]
        error: Arc<dyn SError + Send + Sync + 'static>,
    },
    #[error("{0}")]
    CreateExpr(#[from] CreateExprError),
    #[error("{0}")]
    EvalExpr(#[from] EvalExprError),
}

#[derive(Debug, Error, Clone)]
pub enum CreateExprError {
    #[error("failure building JS function: {0}")]
    BuildFnFailure(String),
}

impl CreateExprError {
    // JsValue is not `Send`, so it is reported as a String first
    pub(crate) fn fn_err(js: JsValue) -> Self {
        Self::BuildFnFailure(js.display().to_string())
    }
}

#[derive(Debug, Error)]
pub enum IntoStreamError {
    #[error("missing provider: {0}")]
    MissingProvider(Arc<str>),
}

#[derive(Debug, Error, Clone, PartialEq, Eq, PartialOrd, Ord)]
#[error("{0}")]
pub struct EvalExprError(pub(crate) String);

impl From<EvalExprErrorInner> for EvalExprError {
    // JsValue is not `Send`, so it is reported as a String first
    fn from(value: EvalExprErrorInner) -> Self {
        Self(value.to_string())
    }
}

#[derive(Debug, Error)]
pub(crate) enum EvalExprErrorInner {
    #[error("provider returned invalid json: {}", .0.display())]
    InvalidJsonFromProvider(JsValue),
    #[error("error executing JS code: {}", .0.display())]
    ExecutionError(JsValue),
    #[error("expression returned invalid json: {}", .0.display())]
    InvalidResultJson(JsValue),
}

#[derive(Debug, Error)]
pub enum QueryGenError {
    #[error("parser error: {0:?}")]
    ParseError(ParseError),
    #[error("failed to compile js code: {0}")]
    JsCompile(String),
    #[error("invalid select: {0}")]
    Select(#[source] Box<Self>),
    #[error("invalid for_each: {0}")]
    ForEach(#[source] Box<Self>),
    #[error("invalid where: {0}")]
    Where(Box<Self>),
    #[error("invalid JSON: {0}")]
    FromJson(#[from] serde_json::Error),
}

impl QueryGenError {
    pub(crate) fn js_compile(js: JsValue) -> Self {
        Self::JsCompile(js.display().to_string())
    }

    pub(crate) fn select(self) -> Self {
        Self::Select(Box::new(self))
    }

    pub(crate) fn for_each(self) -> Self {
        Self::ForEach(Box::new(self))
    }

    pub(crate) fn r#where(self) -> Self {
        Self::Where(Box::new(self))
    }
}

impl From<ParseError> for QueryGenError {
    fn from(value: ParseError) -> Self {
        Self::ParseError(value)
    }
}
