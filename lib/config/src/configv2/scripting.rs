use super::{
    error::{CreateExprError, EvalExprError, EvalExprErrorInner, IntoStreamError},
    templating::{False, Segment, TemplateType, True},
};
use crate::make_send::MakeSend;
use boa_engine::{
    object::{JsArray, JsFunction, ObjectInitializer},
    prelude::*,
    property::{Attribute, PropertyKey},
};
use derivative::Derivative;
use futures::{Stream, TryStreamExt};
use itertools::Itertools;
use std::{
    borrow::Cow,
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    error::Error as StdError,
    sync::Arc,
};
use zip_all::zip_all_map;

pub(crate) use lib_src::{set_source, LibSrc};

pub type ProviderStreamStream<Ar, E> =
    Box<dyn Stream<Item = Result<(serde_json::Value, Vec<Ar>), E>> + Send + Unpin + 'static>;

/// Trait used by Providers in the main `pewpew` package to provide an interface usable by
/// scripting related types here.
///
/// Has to be trait-based so that this package does not need to depend on `pewpew` for the Provider
/// type, which would be a circular dependency.
pub trait ProviderStream<Ar: Clone + Send + Unpin + 'static> {
    type Err: Unpin + std::error::Error;

    /// Returns a Stream object that yields the needed types
    fn as_stream(&self) -> ProviderStreamStream<Ar, Self::Err>;
}

mod lib_src {
    //! Submodule for handling custom js.
    //!
    //! The use of a static means that this solution only works under the assumption that no more
    //! than one load test will be active at any given moment.

    use serde::Deserialize;
    use std::{
        fs, io,
        path::Path,
        sync::{Arc, Mutex},
    };

    #[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
    #[serde(rename_all = "snake_case")]
    #[derive(serde::Serialize)]
    pub(crate) enum LibSrc {
        Inline(Arc<str>),
        Extern(Arc<Path>),
    }

    static SOURCE: Mutex<Option<Arc<str>>> = Mutex::new(None);

    /// Sets the lib source for custom js. Any Expression/Query created after calling this will use
    /// the new lib source, including Cloned ones.
    ///
    /// Should only be called when a new LoadTest is created.
    pub(crate) fn set_source(src: Option<LibSrc>) -> Result<(), io::Error> {
        *(SOURCE.lock().unwrap()) = match src {
            Some(LibSrc::Inline(s)) => Some(s),
            Some(LibSrc::Extern(f)) => Some(fs::read_to_string(f)?.into()),
            None => None,
        };
        Ok(())
    }

    pub(super) fn get_source() -> Option<Arc<str>> {
        (*SOURCE.lock().unwrap()).clone()
    }
}

/// The to_json() method provided by boa panics on any `undefined` value.
///
/// This function should be preferred instead
pub(super) fn purge_undefined(js: &JsValue, context: &mut Context) -> JsResult<serde_json::Value> {
    // copy of to_json() from boa that does not panic on undefined
    fn purge_inner(
        js: &JsValue,
        context: &mut Context,
        // trace parameter helps track where in the "root" js object the undefined was found
        trace: Vec<String>,
    ) -> JsResult<serde_json::Value> {
        match js {
            JsValue::Null => Ok(serde_json::Value::Null),
            &JsValue::Boolean(b) => Ok(b.into()),
            JsValue::String(string) => Ok(string.as_str().into()),
            &JsValue::Rational(rat) => Ok(rat.into()),
            &JsValue::Integer(int) => Ok(int.into()),
            JsValue::BigInt(_bigint) => context.throw_type_error("cannot convert bigint to JSON"),
            JsValue::Symbol(_sym) => context.throw_type_error("cannot convert Symbol to JSON"),
            JsValue::Object(o) => {
                if o.is_array() {
                    let jsarr =
                        JsArray::from_object(o.clone(), context).expect("just checked if array");
                    let len = jsarr.length(context)?;
                    (0..len)
                        .map(|i| {
                            jsarr.get(i, context).and_then(|js| {
                                purge_inner(&js, context, {
                                    let mut trace = trace.clone();
                                    trace.push(i.to_string());
                                    trace
                                })
                            })
                        })
                        .collect::<JsResult<Vec<serde_json::Value>>>()
                        .map(Into::into)
                } else {
                    let mut map = serde_json::Map::new();
                    for (key, property) in o.borrow().properties().iter() {
                        let key = match &key {
                            PropertyKey::String(string) => string.as_str().to_owned(),
                            PropertyKey::Index(i) => i.to_string(),
                            PropertyKey::Symbol(_sym) => {
                                return context.throw_type_error("cannot convert Symbol to JSON")
                            }
                        };

                        let value = match property.value() {
                            Some(val) => purge_inner(val, context, {
                                let mut trace = trace.clone();
                                trace.push(key.clone());
                                trace
                            })?,
                            None => serde_json::Value::Null,
                        };

                        map.insert(key, value);
                    }

                    Ok(serde_json::Value::Object(map))
                }
            }
            JsValue::Undefined => {
                log::error!("js value at trace {trace:?} was `undefined`; falling back to `null`");
                Ok(serde_json::Value::Null)
            }
        }
    }
    purge_inner(js, context, vec![])
}

pub fn eval_direct(code: &str) -> Result<String, EvalExprError> {
    get_default_context()
        .eval(code)
        .map_err(EvalExprErrorInner::ExecutionError)
        .map_err(Into::into)
        .map(|js| js.display().to_string())
}

/// Container struct for JS runtime data for evaluating pewpew expressions.
#[derive(Derivative)]
#[derivative(Debug, PartialEq, Eq)]
pub struct EvalExpr {
    /// JS Context and the function to run for expression evaluation. JS runtime and garbage
    /// collection are thread-local, so MakeSend is used to make this struct Send
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    ctx: MakeSend<(RefCell<Context>, JsFunction)>,
    needed: Arc<[Arc<str>]>,
    /// Cache of the original source used to build this struct. Only used for cloning this struct,
    /// as execution is all handled by the `Context`.
    script: Arc<str>,
}

/// `Context` itself is not `Clone`, so EvalExpr keeps the raw data needed to rebuild an
/// equivalent.
///
/// Any possible changes made to the inner `Context` from previous code execution will not be
/// preserved. Expressions aren't intended to have side effects anyway.
impl Clone for EvalExpr {
    fn clone(&self) -> Self {
        // The fact that this `Context` already exists implies that these values should produce
        // valid output, so it shouldn't ever return an error and panic.
        Self::from_parts(Arc::clone(&self.script), Arc::clone(&self.needed))
            .expect("was already made")
    }
}

impl EvalExpr {
    fn from_parts(script: Arc<str>, needed: Arc<[Arc<str>]>) -> Result<Self, CreateExprError> {
        Ok(Self {
            ctx: MakeSend::try_new::<CreateExprError, _>(|| {
                let mut ctx = builtins::get_default_context();
                ctx.eval(script.as_bytes())
                    .map_err(CreateExprError::fn_err)?;
                let efn = ctx
                    .eval("____eval")
                    .ok()
                    .and_then(|v| v.as_object().cloned())
                    .and_then(JsFunction::from_object)
                    .expect("just created eval fn; should be fine");
                Ok((RefCell::new(ctx), efn))
            })?,
            needed,
            script,
        })
    }

    pub fn from_template<T>(script: Vec<Segment<T, True>>) -> Result<Self, CreateExprError>
    where
        T: TemplateType<ProvAllowed = True, EnvsAllowed = False>,
    {
        let mut needed = Vec::new();
        let mut uses_prov = false;
        let script = Arc::from(format!(
            "function ____eval(____provider_values){{ return {}; }}",
            script
                .into_iter()
                .map(|s| match s {
                    Segment::Raw(s) => s,
                    Segment::Prov(p, ..) => {
                        let s = format!("____provider_values.{p}");
                        needed.push(Arc::from(p));
                        uses_prov = true;
                        s
                    }
                    Segment::Env(_, no) => no.no(),
                    _ => unreachable!("should have inserted vars first"),
                })
                .collect::<String>()
        ));
        if !uses_prov {
            // more of a developer warning in case a previous check broke
            // any expression that doesn't rely on providers should have been evaluated statically
            // by this point
            log::warn!("R-Template expression ({script:?}) does not read from any providers.")
        }
        Self::from_parts(script, Arc::from(needed))
    }

    pub fn required_providers(&self) -> BTreeSet<Arc<str>> {
        self.needed.iter().cloned().collect()
    }

    pub fn evaluate(&self, data: Cow<'_, serde_json::Value>) -> Result<String, EvalExprError> {
        let values = data
            .as_object()
            .ok_or_else(|| EvalExprError("provided data was not a Map".to_owned()))?
            .into_iter()
            .map(|(s, v)| (Arc::from(s.clone()), (v.clone(), vec![])))
            .collect();
        self.ctx.as_ref().and_then(move |(ctx, efn)| {
            let ctx = &mut *ctx.borrow_mut();
            Ok(match Self::eval_raw::<()>(ctx, efn, values)?.0 {
                serde_json::Value::String(s) => s,
                other => other.to_string(),
            })
        })
    }

    fn eval_raw<Ar>(
        ctx: &mut Context,
        efn: &JsFunction,
        values: BTreeMap<Arc<str>, (serde_json::Value, Vec<Ar>)>,
    ) -> Result<(serde_json::Value, Vec<Ar>), EvalExprErrorInner> {
        let values: BTreeMap<_, _> = values
            .into_iter()
            .map(|(n, (v, ar))| {
                JsValue::from_json(&v, ctx)
                    .map_err(EvalExprErrorInner::InvalidJsonFromProvider)
                    .map(|v| (n, (v, ar)))
            })
            .collect::<Result<_, _>>()?;
        let mut object = ObjectInitializer::new(ctx);
        for (name, (value, _)) in values.iter() {
            object.property(name.to_string(), value, Attribute::READONLY);
        }
        let object = object.build();
        Ok((
            purge_undefined(
                &efn.call(&JsValue::Null, &[object.into()], ctx)
                    .map(|js| if js.is_undefined() { JsValue::Null } else { js })
                    .map_err(EvalExprErrorInner::ExecutionError)?,
                ctx,
            )
            .map_err(EvalExprErrorInner::InvalidResultJson)?,
            values.into_iter().flat_map(|v| v.1 .1).collect_vec(),
        ))
    }

    pub(crate) fn into_stream_with<F, Ar, E>(
        self,
        mut provider_get: F,
    ) -> Result<
        impl Stream<Item = Result<(serde_json::Value, Vec<Ar>), E>> + Send + 'static,
        IntoStreamError,
    >
    where
        F: FnMut(
            &str,
        ) -> Option<
            Box<
                dyn Stream<Item = Result<(serde_json::Value, Vec<Ar>), E>> + Send + Unpin + 'static,
            >,
        >,
        Ar: Clone + Send + Unpin + 'static,
        E: Send + Unpin + StdError + 'static + From<EvalExprError>,
    {
        let Self { ctx, needed, .. } = self;
        let providers = needed
            .iter()
            .map(|pn| {
                provider_get(pn)
                    .map(|p| (pn.clone(), p))
                    .ok_or_else(|| IntoStreamError::MissingProvider(pn.clone()))
            })
            .collect::<Result<BTreeMap<Arc<str>, _>, _>>()?;
        Ok(zip_all_map(providers, true).and_then(move |values| {
            ctx.as_ref().and_then(|(ctx, efn)| {
                use futures::future::{err, ok};
                match Self::eval_raw(&mut ctx.borrow_mut(), efn, values) {
                    Ok(v) => ok(v),
                    Err(e) => err(EvalExprError::from(e).into()),
                }
            })
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::LibSrc;
    use boa_engine::{object::JsArray, Context, JsValue};
    use std::{path::PathBuf, sync::Arc};

    // I don't bother calling purge_undefined() in here, because for unit testing we control the
    // inputs, and none of these should be undefined. For production code that users can provide
    // data for, that extra check is needed.

    #[test]
    fn parse_funcs() {
        let mut ctx: Context = super::builtins::get_default_context();
        assert_eq!(ctx.eval(r#"parseInt("5")"#), Ok(JsValue::Integer(5)));
        assert_eq!(ctx.eval(r#"parseInt("5.1")"#), Ok(JsValue::Integer(5)));
        assert_eq!(ctx.eval(r#"parseFloat("5.1")"#), Ok(JsValue::Rational(5.1)));
        assert_eq!(ctx.eval(r#"parseFloat("e")"#), Ok(JsValue::Null));
    }

    #[test]
    fn reapeat_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        let rep_arr = ctx.eval(r#"repeat(3)"#).unwrap();
        let rep_arr = rep_arr.as_object().unwrap();
        assert!(rep_arr.is_array());
        let rep_arr = JsArray::from_object(rep_arr.clone(), &mut ctx).unwrap();
        for _ in 0..3 {
            assert_eq!(rep_arr.pop(&mut ctx).unwrap(), JsValue::Null);
        }
        assert_eq!(rep_arr.pop(&mut ctx).unwrap(), JsValue::Undefined);
    }

    #[test]
    fn pad_fns() {
        let mut ctx: Context = super::builtins::get_default_context();
        assert_eq!(
            ctx.eval(r#"end_pad("foo", 6, "bar")"#),
            Ok(JsValue::String("foobar".into()))
        );
        assert_eq!(
            ctx.eval(r#"end_pad("foo", 7, "bar")"#),
            Ok(JsValue::String("foobarb".into()))
        );
        assert_eq!(
            ctx.eval(r#"end_pad("foo", 1, "fsdajlkvshduva")"#),
            Ok(JsValue::String("foo".into()))
        );
        assert_eq!(
            ctx.eval(r#"end_pad("foo", 4, "")"#),
            Ok(JsValue::String("foo".into()))
        );

        assert_eq!(
            ctx.eval(r#"start_pad("foo", 6, "bar")"#),
            Ok(JsValue::String("barfoo".into()))
        );
        assert_eq!(
            ctx.eval(r#"start_pad("foo", 7, "bar")"#),
            Ok(JsValue::String("barbfoo".into()))
        );
        assert_eq!(
            ctx.eval(r#"start_pad("foo", 1, "fsdajlkvshduva")"#),
            Ok(JsValue::String("foo".into()))
        );
        assert_eq!(
            ctx.eval(r#"start_pad("foo", 4, "")"#),
            Ok(JsValue::String("foo".into()))
        );
    }

    #[test]
    fn encode_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        assert_eq!(
            ctx.eval(r#"encode("foo=bar", "percent-userinfo")"#),
            Ok(JsValue::String("foo%3Dbar".into()))
        );
    }

    #[test]
    fn epoch_fn() {
        let mut ctx: Context = super::builtins::get_default_context();

        let mut eval_str = |s: &str| {
            ctx.eval(s)
                .unwrap()
                .as_string()
                .unwrap()
                .as_str()
                .to_owned()
        };

        let ep = eval_str(r#"epoch("s")"#);
        assert_eq!(ep.len(), 10);
        let prev = ep.as_str();

        let ep = eval_str(r#"epoch("ms")"#);
        assert_eq!(ep.len(), 13);
        let curr = &ep[..10];
        assert_eq!(curr, prev, "if these are off by one, don't worry");
        let prev = ep;

        let ep = eval_str(r#"epoch("mu")"#);
        assert_eq!(ep.len(), 16);
        let curr = &ep[..13];
        assert_eq!(curr[..7], prev[..7]); // more likely to be off
        let prev = ep;

        let ep = eval_str(r#"epoch("ns")"#);
        assert_eq!(ep.len(), 19);
        let curr = &ep[..16];
        assert_eq!(curr[..7], prev[..7]);
    }

    #[test]
    fn entries_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        assert_eq!(
            ctx.eval(r#"entries({"foo": "bar", "baz": 123})"#)
                .unwrap()
                .to_json(&mut ctx)
                .unwrap(),
            serde_json::json!([["foo", "bar"], ["baz", 123]])
        );
        assert_eq!(
            ctx.eval(r#"entries(["abc", "def"])"#)
                .unwrap()
                .to_json(&mut ctx)
                .unwrap(),
            serde_json::json!([[0, "abc"], [1, "def"]])
        );
        assert_eq!(
            ctx.eval(r#"entries("xyz")"#)
                .unwrap()
                .to_json(&mut ctx)
                .unwrap(),
            serde_json::json!([[0, "x"], [1, "y"], [2, "z"]])
        );
        assert_eq!(ctx.eval("entries(null)"), Ok(JsValue::Null));
    }

    #[test]
    fn random_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        // not testing value ranges, just int * int -> int
        assert!(matches!(
            ctx.eval(r#"random(1, 4)"#),
            Ok(JsValue::Integer(_))
        ));
        assert!(matches!(
            ctx.eval(r#"random(1.1, 4)"#),
            Ok(JsValue::Rational(_))
        ));
        assert!(matches!(
            ctx.eval(r#"random(1, 4.1)"#),
            Ok(JsValue::Rational(_))
        ));
        assert!(matches!(
            ctx.eval(r#"random(1.001, 4.09)"#),
            Ok(JsValue::Rational(_))
        ));
    }

    #[test]
    fn range_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        assert_eq!(
            ctx.eval("range(1, 10)").unwrap().to_json(&mut ctx).unwrap(),
            serde_json::json!([1, 2, 3, 4, 5, 6, 7, 8, 9])
        );
        assert_eq!(
            ctx.eval("range(10, 1)").unwrap().to_json(&mut ctx).unwrap(),
            serde_json::json!([10, 9, 8, 7, 6, 5, 4, 3, 2])
        );
    }

    #[test]
    fn replace_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        assert_eq!(
            ctx.eval(r#"replace("foo", {"foo": "baz", "zed": ["abc", 123, "fooo"]}, "bar")"#)
                .unwrap()
                .to_json(&mut ctx)
                .unwrap(),
            serde_json::json!({"bar": "baz", "zed": ["abc", 123, "baro"]})
        )
    }

    #[test]
    fn join_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        assert_eq!(
            ctx.eval(r#"join(["foo", "bar", "baz"], "-")"#),
            Ok(JsValue::String("foo-bar-baz".into()))
        );
        assert_eq!(
            ctx.eval(r#"join({"a": 1, "b": 2}, "\n", ": ")"#),
            Ok(JsValue::String("a: 1\nb: 2".into()))
        );
    }

    #[test]
    fn match_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        let caps = ctx.eval(
            r#"match("<html>\n<body>\nHello, Jean! Today's date is 2038-01-19. So glad you made it!\n</body>\n</html>", "Hello, (?P<name>\\w+).*(?P<y>\\d{4})-(?P<m>\\d{2})-(?P<d>\\d{2})")"#
        ).map_err(|js| js.display().to_string()).unwrap();
        let caps = caps.to_json(&mut ctx).unwrap();
        assert_eq!(
            caps,
            serde_json::json!({
                "0": "Hello, Jean! Today's date is 2038-01-19",
                "name": "Jean",
                "y": "2038",
                "m": "01",
                "d": "19"
            })
        );
    }

    #[test]
    fn json_path_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        let val = ctx
            .eval(r#"json_path({"a": [{"c": 1}, {"c": 2}], "b": null}, "$.a.*.c")"#)
            .map_err(|js| js.display().to_string())
            .unwrap()
            .to_json(&mut ctx)
            .unwrap();
        assert_eq!(val, serde_json::json!([1, 2]));
        // ensure that same cached path works as expected on different data
        let val = ctx
            .eval(r#"json_path({"a": [{"c": 56}, {"c": 88}], "b": null}, "$.a.*.c")"#)
            .map_err(|js| js.display().to_string())
            .unwrap()
            .to_json(&mut ctx)
            .unwrap();
        assert_eq!(val, serde_json::json!([56, 88]));
    }

    #[test]
    fn val_eq_fn() {
        let mut ctx: Context = super::builtins::get_default_context();
        let val = ctx.eval("[1] == [1]").unwrap().as_boolean().unwrap();
        assert!(!val);
        let val = ctx.eval("val_eq([1], [1])").unwrap().as_boolean().unwrap();
        assert!(val);
    }

    #[test]
    fn custom_js() {
        super::set_source(Some(LibSrc::Extern(Arc::from(PathBuf::from(
            "./tests/test_custom.js",
        )))))
        .unwrap();

        let mut ctx = super::get_default_context();

        assert_eq!(
            ctx.eval(r#"foo_custom({x: 55})"#)
                .map_err(|e| e.display().to_string())
                .unwrap(),
            JsValue::Integer(55)
        );
        assert_eq!(
            ctx.eval(r#"foo_custom({y: 55})"#)
                .map_err(|e| e.display().to_string())
                .unwrap(),
            JsValue::Integer(2)
        );

        assert_eq!(
            ctx.eval("calls_entries([1, 2, 3])")
                .unwrap()
                .to_json(&mut ctx)
                .unwrap(),
            serde_json::json!({
                "normal": [[0, 1], [1, 2], [2, 3]],
                "reversed": [[0, 3], [1, 2], [2, 1]],
            })
        );
    }
}

pub fn get_default_context() -> Context {
    // the function called here is written by the `boa_mod` macro
    let mut ctx = builtins::get_default_context();
    match lib_src::get_source().as_deref() {
        Some(s) => match ctx.eval(s) {
            Ok(_) => ctx,
            Err(e) => {
                // Function does not return a Result because that would need to be handled every
                // time this function is called, and the return value of this function should never
                // change after the first time.
                log::error!("error inserting custom js: {}", e.display());
                builtins::get_default_context()
            }
        },
        None => ctx,
    }
}

#[scripting_macros::boa_mod]
mod builtins {
    //! Built-in expression functions
    //!
    //! These functions are callable by the JS Runtime used for pewpew expressions.
    //!
    //! For the function to be properly handled and callable:
    //!
    //! - Any input type `T` must implement `JsInput`.
    //! - Any output type `O` must implement `AsJsResult`.
    //! - The `#[boa_fn]` attribute macro must be applied. A `jsname` parameter
    //!   may also be provided to set the name that this function will be callable
    //!   from the JS runtime as; with no `jsname`, the default will be the
    //!   native Rust function name.
    //!
    //! IMPORTANT: Do **NOT** let these functions panic if at all possible, as all scripting
    //! operations are done on a shared thread, and any panic will make all expressions fail to
    //! execute for the rest of the program runtime.

    use crate::shared::{encode::Encoding, Epoch};
    use helper::{AnyAsString, AnyNull, NumType, OrNull};
    use rand::{thread_rng, Rng};
    use regex::Regex;
    use scripting_macros::boa_fn;
    use serde_json::Value as SJV;
    use std::{
        borrow::Cow,
        cmp::Ordering,
        collections::BTreeMap,
        sync::{Arc, Mutex},
    };

    #[boa_fn]
    fn encode(s: AnyAsString, e: Encoding) -> String {
        e.encode_str(&s.get())
    }

    #[boa_fn]
    fn end_pad(s: AnyAsString, min_length: i64, pad_string: &str) -> String {
        use unicode_segmentation::UnicodeSegmentation;
        let mut s = s.get();
        let needed_chars = (min_length as usize).saturating_sub(s.len());

        let pad_chars: String = pad_string
            .graphemes(true)
            .cycle()
            .take(needed_chars)
            .collect();

        s.push_str(&pad_chars);
        s
    }

    #[boa_fn]
    fn entries(value: SJV) -> SJV {
        fn collect<K: Into<SJV>, V: Into<SJV>, I: IntoIterator<Item = (K, V)>>(iter: I) -> SJV {
            iter.into_iter()
                .map(|(k, v)| SJV::Array(vec![k.into(), v.into()]))
                .collect::<Vec<_>>()
                .into()
        }
        match value {
            SJV::Array(a) => collect(a.into_iter().enumerate()),
            SJV::Object(o) => collect(o),
            SJV::String(s) => collect(s.chars().enumerate().map(|(i, c)| (i, c.to_string()))),
            other => other,
        }
    }

    #[boa_fn]
    fn epoch(e: Epoch, _: Option<AnyNull>) -> String {
        e.get().to_string()
    }

    #[boa_fn]
    fn join(value: SJV, separator: &str, separator2: Option<&str>) -> String {
        // The std ToString impl for SJV put extra "" around the String
        fn get_as_str(v: &SJV) -> Cow<str> {
            match v {
                SJV::String(s) => Cow::Borrowed(s),
                other => Cow::Owned(other.to_string()),
            }
        }
        let s = separator;
        let s2 = separator2;
        match (value, s2) {
            (SJV::Array(a), _) => a.iter().map(get_as_str).collect::<Vec<_>>().join(s),
            (SJV::Object(m), Some(s2)) => m
                .into_iter()
                .map(|(k, v)| format!("{k}{s2}{0}", get_as_str(&v)))
                .collect::<Vec<_>>()
                .join(s),
            (SJV::String(s), _) => s,
            (other, _) => other.to_string(),
        }
    }

    #[boa_fn]
    fn json_path(v: SJV, s: &str) -> Vec<SJV> {
        use jsonpath_lib::Compiled;
        // same pattern as in `match` helper function
        fn get_node(s: &str) -> Arc<Result<Compiled, String>> {
            static PATH_CACHE: Mutex<BTreeMap<String, Arc<Result<Compiled, String>>>> =
                Mutex::new(BTreeMap::new());

            match PATH_CACHE.lock() {
                Ok(mut c) => c
                    .entry(s.to_owned())
                    .or_insert_with(|| Arc::new(jsonpath_lib::Compiled::compile(s)))
                    .clone(),
                Err(_) => {
                    log::warn!("jsonpath cache Mutex has been poisoned");
                    Arc::new(jsonpath_lib::Compiled::compile(s))
                }
            }
        }
        let path = get_node(s);
        let path = match &*path {
            Ok(p) => p,
            Err(e) => {
                log::error!("invalid json path {s:?} ({e})");
                return vec![];
            }
        };
        path.select(&v)
            .map(|v| v.into_iter().cloned().collect())
            .unwrap_or(vec![])
    }

    #[boa_fn(jsname = "match")]
    fn r#match(s: AnyAsString, regex: &str) -> SJV {
        // Prevent same Regex from being compiled again.
        fn get_reg(reg: &str) -> Arc<Result<Regex, regex::Error>> {
            // does not need to be a tokio::Mutex, as LockGuard is not held beyond any await point,
            // being dropped within this purely-non-async function.
            static REG_CACHE: Mutex<BTreeMap<String, Arc<Result<Regex, regex::Error>>>> =
                Mutex::new(BTreeMap::new());

            match REG_CACHE.lock() {
                Ok(mut c) => c
                    .entry(reg.to_owned())
                    .or_insert_with(|| Arc::new(Regex::new(reg)))
                    .clone(),
                Err(_) => {
                    log::warn!("regex cache mutex has been poisoned");
                    Arc::new(Regex::new(reg))
                }
            }
        }
        let s = s.get();
        let reg = get_reg(regex);
        let reg = match &*reg {
            Ok(reg) => reg,
            Err(e) => {
                log::error!("string {regex:?} is not a valid Regex ({e})");
                return SJV::Null;
            }
        };
        let caps = match reg.captures(&s) {
            Some(c) => c,
            None => return SJV::Null,
        };
        SJV::Object(
            reg.capture_names()
                .enumerate()
                .map(|(i, n)| {
                    // get all capture groups, numbered or named
                    n.map_or_else(
                        || (i.to_string(), caps.get(i)),
                        |n| (n.to_string(), caps.name(n)),
                    )
                })
                .map(|(i, m)| {
                    (
                        i,
                        m.map_or(SJV::Null, |m| SJV::String(m.as_str().to_owned())),
                    )
                })
                .collect(),
        )
    }

    #[boa_fn(jsname = "parseInt")]
    fn parse_int(s: AnyAsString) -> OrNull<i64> {
        let s = s.get();
        let s = s.as_str();
        s.parse()
            .ok()
            .or_else(|| s.parse::<f64>().ok().map(|x| x as i64))
            .into()
    }

    #[boa_fn(jsname = "parseFloat")]
    fn parse_float(s: AnyAsString) -> OrNull<f64> {
        s.get().parse().ok().into()
    }

    #[boa_fn]
    fn random(min: NumType, max: NumType, _: Option<AnyNull>) -> NumType {
        match (min, max) {
            (NumType::Int(i), NumType::Int(j)) => NumType::Int(thread_rng().gen_range(i..j)),
            (i, j) => {
                let (i, j) = (i.as_float(), j.as_float());
                NumType::Real(thread_rng().gen_range(i..j))
            }
        }
    }

    #[boa_fn]
    fn range(start: i64, end: i64) -> Vec<i64> {
        match start.cmp(&end) {
            Ordering::Equal => vec![],
            Ordering::Less => (start..end).collect(),
            Ordering::Greater => ((end + 1)..=start).rev().collect(),
        }
    }

    #[boa_fn]
    fn repeat(min: i64, max: Option<i64>) -> Vec<()> {
        let min = min as usize;
        let len = match max {
            Some(max) => thread_rng().gen_range(min..=(max as usize)),
            None => min,
        };
        vec![(); len]
    }

    #[boa_fn]
    fn replace(needle: &str, haystack: SJV, replacer: &str) -> SJV {
        let n = needle;
        let r = replacer;
        match haystack {
            SJV::String(s) => SJV::String(s.replace(n, r)),
            SJV::Array(a) => a
                .into_iter()
                .map(|v| replace(n, v, r))
                .collect::<Vec<_>>()
                .into(),
            SJV::Object(m) => SJV::Object(
                m.into_iter()
                    .map(|(k, v)| (k.replace(n, r), replace(n, v, r)))
                    .collect(),
            ),
            other => other,
        }
    }

    #[boa_fn]
    fn start_pad(s: AnyAsString, min_length: i64, pad_string: &str) -> String {
        use unicode_segmentation::UnicodeSegmentation;
        let s = s.get();
        let needed_chars = (min_length as usize).saturating_sub(s.len());

        let mut pad_chars: String = pad_string
            .graphemes(true)
            .cycle()
            .take(needed_chars)
            .collect();

        pad_chars.push_str(&s);
        pad_chars
    }

    #[boa_fn]
    fn stwrap(s: &str) -> String {
        format!("\"{s}\"")
    }

    #[boa_fn]
    fn val_eq(a: SJV, b: SJV) -> bool {
        // By-value comparison for js values, as Array and Object are compared by reference
        a == b
    }

    mod helper {
        #![allow(clippy::wrong_self_convention)]

        use crate::shared::{encode::Encoding, Epoch};
        use boa_engine::{object::JsArray, Context, JsResult, JsValue};
        use std::fmt::Display;

        /// This trait must be implemented for any type used as an input parameter on one of the
        /// helper functions.
        ///
        /// boa engine requires JsValues as the inputs, so this trait is used for the purpose of
        /// reducing boilerplate on the helper functions.
        ///
        /// The code that actually calls this method is written by the `#[boa_fn]` macro.
        pub(super) trait JsInput<'a>: Sized + 'a {
            fn from_js(js: &'a JsValue, ctx: &mut Context) -> JsResult<Self>;
        }

        impl JsInput<'_> for serde_json::Value {
            fn from_js(js: &JsValue, ctx: &mut Context) -> JsResult<Self> {
                super::super::purge_undefined(js, ctx)
            }
        }

        impl<'a, T: JsInput<'a>> JsInput<'a> for Option<T> {
            fn from_js(js: &'a JsValue, ctx: &mut Context) -> JsResult<Self> {
                Ok(T::from_js(js, ctx).ok())
            }
        }

        impl<'a> JsInput<'a> for &'a str {
            fn from_js(js: &'a JsValue, ctx: &mut Context) -> JsResult<Self> {
                Ok(js
                    .as_string()
                    .ok_or_else(|| ctx.construct_type_error("not a string"))?
                    .as_str())
            }
        }

        impl JsInput<'_> for i64 {
            fn from_js(js: &JsValue, ctx: &mut Context) -> JsResult<Self> {
                match js {
                    JsValue::Integer(i) => Ok(*i as i64),
                    JsValue::Rational(r) => {
                        log::trace!("casting float to int");
                        Ok(*r as i64)
                    }
                    _ => Err(ctx.construct_type_error("not an int")),
                }
            }
        }

        /// Input that represents any JsValue that will then be discarded and not used.
        /// Its purpose is for a dummy value, as described in the book, to allow forcing a
        /// non-deterministic function (such as random()) to be called each time.
        pub(super) struct AnyNull;

        impl JsInput<'_> for AnyNull {
            fn from_js(_: &JsValue, _: &mut Context) -> JsResult<Self> {
                Ok(Self)
            }
        }

        impl JsInput<'_> for Encoding {
            fn from_js(js: &JsValue, ctx: &mut Context) -> JsResult<Self> {
                let s: &str = JsInput::from_js(js, ctx)?;
                s.parse()
                    .map_err(|_| ctx.construct_type_error("invalid string for Encoding"))
            }
        }

        impl JsInput<'_> for Epoch {
            fn from_js(js: &JsValue, ctx: &mut Context) -> JsResult<Self> {
                let s: &str = JsInput::from_js(js, ctx)?;
                s.parse()
                    .map_err(|_| ctx.construct_type_error("invalid string for Epoch"))
            }
        }

        /// Function input representing any valid JS expression, coerced to a String
        pub(super) struct AnyAsString(String);

        impl JsInput<'_> for AnyAsString {
            fn from_js(js: &JsValue, ctx: &mut Context) -> JsResult<Self> {
                Ok(Self(js.to_string(ctx)?.as_str().to_owned()))
            }
        }

        impl AnyAsString {
            pub fn get(self) -> String {
                self.0
            }
        }

        /// Function input/output representing either number type
        pub(super) enum NumType {
            Int(i64),
            Real(f64),
        }

        impl NumType {
            pub fn as_float(self) -> f64 {
                match self {
                    Self::Int(i) => i as f64,
                    Self::Real(f) => f,
                }
            }
        }

        impl JsInput<'_> for NumType {
            fn from_js(js: &JsValue, ctx: &mut Context) -> JsResult<Self> {
                match js {
                    JsValue::Integer(i) => Ok(Self::Int(*i as i64)),
                    JsValue::Rational(f) => Ok(Self::Real(*f)),
                    _ => Err(ctx.construct_type_error("needed numerical")),
                }
            }
        }

        /// Trait for helper function output.
        ///
        /// Any type used as a return type for a `#[boa_fn]` must implement this trait.
        ///
        /// boa engine requires `JsResult<JsValue>` as the output for functions, so this is used to
        /// reduce boilerplate.
        ///
        /// Code that actually calls this method is written by the `#[boa_fn]` macro.
        pub(super) trait AsJsResult {
            fn as_js_result(self, _: &mut Context) -> JsResult<JsValue>;
        }

        impl AsJsResult for serde_json::Value {
            fn as_js_result(self, ctx: &mut Context) -> JsResult<JsValue> {
                JsValue::from_json(&self, ctx)
            }
        }

        impl AsJsResult for f64 {
            fn as_js_result(self, _: &mut Context) -> JsResult<JsValue> {
                Ok(JsValue::Rational(self))
            }
        }

        impl AsJsResult for i64 {
            fn as_js_result(self, _: &mut Context) -> JsResult<JsValue> {
                Ok(JsValue::Integer(self as i32))
            }
        }

        impl AsJsResult for String {
            fn as_js_result(self, _: &mut Context) -> JsResult<JsValue> {
                Ok(JsValue::String(self.into()))
            }
        }

        impl AsJsResult for bool {
            fn as_js_result(self, _: &mut Context) -> JsResult<JsValue> {
                Ok(JsValue::Boolean(self))
            }
        }

        /// Represents an output that is always a valid JsValue, defaulting to `null` if no value
        /// is explicitly provided.
        ///
        /// In contrast to standard `Option<T>`, which errors in the None case.
        pub struct OrNull<T>(pub(super) Option<T>);

        impl<T> From<Option<T>> for OrNull<T> {
            fn from(value: Option<T>) -> Self {
                Self(value)
            }
        }

        impl<T: AsJsResult> AsJsResult for OrNull<T> {
            fn as_js_result(self, ctx: &mut Context) -> JsResult<JsValue> {
                Ok(self.0.as_js_result(ctx).unwrap_or(JsValue::Null))
            }
        }

        impl<T: AsJsResult> AsJsResult for Option<T> {
            fn as_js_result(self, ctx: &mut Context) -> JsResult<JsValue> {
                self.map(|x| x.as_js_result(ctx))
                    .transpose()?
                    .ok_or_else(|| JsValue::String("missing value".into()))
            }
        }

        impl<T: AsJsResult, E: Display> AsJsResult for Result<T, E> {
            fn as_js_result(self, ctx: &mut Context) -> JsResult<JsValue> {
                self.map_err(|e| JsValue::String(e.to_string().into()))
                    .and_then(|x| x.as_js_result(ctx))
            }
        }

        impl<T: AsJsResult> AsJsResult for Vec<T> {
            fn as_js_result(self, ctx: &mut Context) -> JsResult<JsValue> {
                Ok(JsArray::from_iter(
                    self.into_iter()
                        .map(|r| r.as_js_result(ctx))
                        .collect::<JsResult<Vec<_>>>()?,
                    ctx,
                )
                .into())
            }
        }

        impl AsJsResult for () {
            fn as_js_result(self, _: &mut Context) -> JsResult<JsValue> {
                Ok(JsValue::Null)
            }
        }

        impl AsJsResult for NumType {
            fn as_js_result(self, _: &mut Context) -> JsResult<JsValue> {
                Ok(match self {
                    Self::Int(i) => JsValue::Integer(i as i32),
                    Self::Real(f) => JsValue::Rational(f),
                })
            }
        }
    }
}
