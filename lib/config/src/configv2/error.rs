use boa_engine::{Context, JsError, JsNativeError, JsValue};
use boa_parser::Error as ParseError;
use std::{error::Error as SError, io, sync::Arc};
use thiserror::Error;

/// Render a [`JsError`] as a [`JsValue`] for reporting.
///
/// boa 0.22 added an `Engine` error representation (runtime limits such as recursion depth) that
/// has no JS object form, which made `JsError::into_opaque` fallible; 0.21's `to_opaque` could not
/// fail because only the native and opaque representations existed. Fall back to the error's own
/// `Display` so an engine error still reports its message rather than being swallowed.
pub(crate) fn js_error_to_value(err: JsError, ctx: &mut Context) -> JsValue {
    // `into_opaque` hands the original error back in `Err`, so the fallback below is only built
    // for the rare engine-error arm. Doing it eagerly would walk the shadow-stack backtrace and
    // allocate on every JS error, and expression errors can fire per request.
    match err.into_opaque(ctx) {
        Ok(value) => value,
        // Wrap the text in an `Error` rather than handing back a primitive string. Every caller
        // renders this with `JsValue::display()`, which formats a primitive string through
        // `{:?}` -- a runtime-limit message would come out quoted and escaped. An `Error` object
        // renders as `Name: message`, like every other error the callers report.
        Err(engine_err) => JsNativeError::error()
            .with_message(engine_err.to_string())
            .into_opaque(ctx)
            .into(),
    }
}

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
    #[error("error executing JS code: {0}\nCode: {1}")]
    ExecutionError(String, String),
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

#[cfg(test)]
mod tests {
    use super::js_error_to_value;
    use boa_engine::{
        error::{EngineError, RuntimeLimitError},
        js_string, Context, JsError, JsNativeError, JsValue, Source,
    };

    /// The ordinary path: a native error converts to its opaque form and renders as
    /// `Name: message`, unquoted.
    #[test]
    fn js_error_to_value_renders_a_native_error_plainly() {
        let ctx = &mut Context::default();
        let err: JsError = JsNativeError::typ().with_message("bad argument").into();

        let rendered = js_error_to_value(err, ctx).display().to_string();

        assert!(
            rendered.starts_with("TypeError: bad argument"),
            "got {rendered}"
        );
    }

    /// An error thrown from JS is already opaque, so it converts rather than falling back.
    #[test]
    fn js_error_to_value_renders_a_thrown_error_plainly() {
        let ctx = &mut Context::default();
        let err = ctx
            .eval(Source::from_bytes(
                r#"throw new RangeError("out of range")"#,
            ))
            .expect_err("the script throws");

        let rendered = js_error_to_value(err, ctx).display().to_string();

        assert!(
            rendered.starts_with("RangeError: out of range"),
            "got {rendered}"
        );
    }

    /// The fallback path, and the reason it wraps the text in an `Error`.
    ///
    /// boa 0.22's engine errors (runtime limits) have no JS object form, so `into_opaque` hands
    /// the error back rather than converting it. Handing back a primitive `JsString` instead
    /// would be rendered by `display()` through `{:?}`, producing a quoted and escaped literal
    /// where every other error reports as `Name: message`.
    #[test]
    fn js_error_to_value_renders_an_engine_error_plainly() {
        let ctx = &mut Context::default();
        let err: JsError = EngineError::RuntimeLimit(RuntimeLimitError::Recursion).into();
        // Precondition: this is the arm `into_opaque` cannot convert.
        assert!(
            err.clone().into_opaque(ctx).is_err(),
            "expected the engine-error arm"
        );

        let rendered = js_error_to_value(err, ctx).display().to_string();

        assert!(
            rendered.starts_with("Error: "),
            "expected an Error object rendering, got {rendered}"
        );
        assert!(
            rendered.contains("recursive calls"),
            "the underlying message should survive, got {rendered}"
        );

        // What the rejected alternative would have produced, so this stays a guard rather than
        // a description: a primitive string renders quoted.
        let as_primitive = JsValue::from(js_string!("Error: some engine failure"))
            .display()
            .to_string();
        assert!(
            as_primitive.starts_with('"'),
            "a primitive string should render quoted, got {as_primitive}"
        );
        assert!(
            !rendered.starts_with('"'),
            "the fallback must not render as a quoted literal, got {rendered}"
        );
    }
}
