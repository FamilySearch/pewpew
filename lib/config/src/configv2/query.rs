use boa_engine::{
    object::{JsArray, ObjectInitializer},
    property::Attribute,
    vm::CodeBlock,
    Context, JsResult, JsValue,
};
use gc::Gc;
use itertools::Itertools;
use serde::Deserialize;
use serde_json::Value as SJVal;
use std::{
    cell::{OnceCell, RefCell},
    collections::{BTreeMap, VecDeque},
    convert::{TryFrom, TryInto},
    fmt,
    marker::PhantomData,
    rc::Rc,
    sync::Arc,
};

use crate::{
    error::{EvalExprError, EvalExprErrorInner, QueryGenError},
    make_send::MakeSend,
    templating::{Bool, False, True},
};

use super::{scripting::purge_undefined, PropagateVars, VarValue, Vars};

type SelectTmp = Select<Arc<str>>;

#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
#[serde(try_from = "QueryTmp")]
pub struct Query<VD: Bool = True>(MakeSend<QueryInner>, PhantomData<VD>);

// Inserting vars does not change any structure, it just adds the `_v` data to the context.
impl PropagateVars for Query<False> {
    type Data<VD: Bool> = Query<VD>;

    fn insert_vars(self, vars: &Vars<True>) -> Result<Self::Data<True>, crate::error::VarsError> {
        let v = SJVal::from(VarValue::Map(vars.clone()));

        self.0.as_ref().and_then(|q| {
            let v = q.vars.get_or_init(|| Arc::new(v));
            let js = JsValue::from_json(v, &mut q.ctx.borrow_mut()).expect("TODO");
            q.ctx
                .borrow_mut()
                .register_global_property("_v", js, Attribute::READONLY);
        });

        let Self(q, _) = self;
        Ok(Query(q, PhantomData))
    }
}

impl<VD: Bool> serde::ser::Serialize for Query<VD> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let src = self.0.as_ref().and_then(|q| (*q.src).clone());
        src.serialize(serializer)
    }
}

impl Query<True> {
    /// Perform the query on the passed in `data`.
    ///
    /// Each [`serde_json::Value`] in the output iterator represents a selection from one of the
    /// `for_each` entries, or, if no `for_each` was specified, the iterator will yield a single
    /// value.
    pub fn query(
        &self,
        data: Arc<SJVal>,
    ) -> Result<impl Iterator<Item = Result<SJVal, EvalExprError>> + Send, EvalExprError> {
        self.0.as_ref().and_then(|q| {
            Ok(q.query(data)?
                .map(|i| i.map_err(Into::into))
                .collect_vec()
                .into_iter())
        })
    }
}

impl<VD: Bool> Query<VD> {
    /// Create a new simple query where the passed in `select` is a single expression that is
    /// evaluated.
    pub fn simple(
        select: String,
        for_each: Vec<String>,
        r#where: Option<String>,
    ) -> Result<Self, QueryGenError> {
        QueryTmp {
            select: SelectTmp::Expr(Arc::from(select)),
            for_each,
            r#where,
        }
        .try_into()
    }

    /// Create a query from a JSON string.
    ///
    /// The json defines the structure of the select, where any terminal string value is an
    /// expression to evaluate.
    pub fn complex_json(
        json: &str,
        for_each: Vec<String>,
        r#where: Option<String>,
    ) -> Result<Self, QueryGenError> {
        let structure: SelectTmp = serde_json::from_str(json)?;

        QueryTmp {
            select: structure,
            for_each,
            r#where,
        }
        .try_into()
    }

    /// Create a query from a JSON string.
    ///
    /// The json defines the structure of the select, where any terminal string value is an
    /// expression to evaluate.
    pub fn from_json(json: &str) -> Result<Self, QueryGenError> {
        Query::complex_json(json, vec![], None)
    }
}

impl<VD: Bool> TryFrom<QueryTmp> for Query<VD> {
    type Error = QueryGenError;

    fn try_from(value: QueryTmp) -> Result<Self, Self::Error> {
        MakeSend::try_new(move || QueryInner::try_from(Rc::new(value)))
            .map(|qi| Self(qi, PhantomData))
    }
}

struct QueryInner {
    select: Select,
    for_each: Vec<Gc<CodeBlock>>,
    r#where: Option<Gc<CodeBlock>>,
    ctx: RefCell<Context>,
    /// used for rebuilding on Clone
    src: Rc<QueryTmp>,
    vars: OnceCell<Arc<SJVal>>,
}

impl PartialEq for QueryInner {
    fn eq(&self, other: &Self) -> bool {
        self.src == other.src
    }
}

impl Eq for QueryInner {}

impl serde::ser::Serialize for QueryInner {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.src.serialize(serializer)
    }
}

impl Clone for QueryInner {
    fn clone(&self) -> Self {
        let q = Self::try_from(Rc::clone(&self.src)).expect("was already made");
        if let Some(vars) = self.vars.get() {
            let _ = q.vars.set(vars.clone());
            let v = q.vars.get().unwrap();
            let js = JsValue::from_json(v, &mut q.ctx.borrow_mut()).expect("TODO");
            q.ctx
                .borrow_mut()
                .register_global_property("_v", js, Attribute::READONLY);
        }
        q
    }
}

impl fmt::Debug for QueryInner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.src.fmt(f)
    }
}

#[derive(Debug, Deserialize, serde::Serialize, Clone, PartialEq, Eq)]
struct QueryTmp {
    select: SelectTmp,
    #[serde(default = "Vec::new")]
    for_each: Vec<String>,
    r#where: Option<String>,
}

impl TryFrom<Rc<QueryTmp>> for QueryInner {
    type Error = QueryGenError;

    fn try_from(value: Rc<QueryTmp>) -> Result<Self, Self::Error> {
        let ctx = get_context();
        let select = value
            .select
            .compile(&mut ctx.borrow_mut())
            .map_err(QueryGenError::select)?;
        let for_each = value
            .for_each
            .iter()
            .map(|fe| compile(fe, &mut ctx.borrow_mut()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(QueryGenError::for_each)?;
        let r#where = value
            .r#where
            .as_ref()
            .map(|w| compile(w, &mut ctx.borrow_mut()).map_err(QueryGenError::r#where))
            .transpose()?;

        Ok(Self {
            select,
            for_each,
            r#where,
            ctx,
            src: value,
            vars: OnceCell::new(),
        })
    }
}

fn compile(src: &str, ctx: &mut Context) -> Result<Gc<CodeBlock>, QueryGenError> {
    use boa_engine::syntax::Parser;

    let code = Parser::new(src.as_bytes()).parse_all(ctx)?;
    ctx.compile(&code).map_err(QueryGenError::js_compile)
}

fn get_context() -> RefCell<Context> {
    RefCell::from(super::scripting::get_default_context())
}

impl QueryInner {
    fn query(
        &self,
        data: Arc<SJVal>,
    ) -> Result<impl Iterator<Item = Result<SJVal, EvalExprErrorInner>>, EvalExprErrorInner> {
        use EvalExprErrorInner::ExecutionError;
        log::trace!("Running Query: {:?} on data {data:?}", self.src);
        let mut ctx = self.ctx.borrow_mut();
        let ctx = &mut ctx;
        let data = data.as_object().unwrap();
        data.iter()
            .filter(|(n, _)| *n != "null")
            .map(|(n, o)| {
                (
                    n,
                    JsValue::from_json(o, ctx)
                        .ok()
                        .unwrap_or(JsValue::Undefined),
                )
            })
            .collect_vec()
            .into_iter()
            // put the provider values into the context for the query expressions to read
            // unlike template expressions, queries access providers directly
            .for_each(|(n, o)| ctx.register_global_property(n.as_str(), o, Attribute::READONLY));
        let for_each = {
            let for_each: Vec<VecDeque<JsValue>> = self
                .for_each
                .iter()
                .map(|fe| ctx.execute(fe.clone()).map_err(ExecutionError))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .map(|jv| {
                    Ok(match jv {
                        JsValue::Object(o) if o.is_array() => {
                            let a = JsArray::from_object(o, ctx).map_err(ExecutionError)?;
                            let mut vd = VecDeque::with_capacity(a.length(ctx).unwrap() as usize);
                            while a.length(ctx).map_err(ExecutionError)? > 0 {
                                let v = a.pop(ctx).map_err(ExecutionError)?;
                                vd.push_front(v)
                            }
                            vd
                        }
                        v => vec![v].into(),
                    })
                })
                .collect::<Result<Vec<_>, EvalExprErrorInner>>()?;
            let for_each = for_each
                .into_iter()
                .multi_cartesian_product()
                .map(|v| JsArray::from_iter(v, ctx).into())
                .collect_vec();
            // If no for_each entries are specified, just select one time.
            if for_each.is_empty() {
                vec![JsValue::Undefined]
            } else {
                for_each
            }
        };
        Ok(for_each
            .into_iter()
            .map(|x| {
                // NOTE: this function got changed in boa 0.17, where it returns an error if the
                // same property is "registered" twice, as opposed to the current behavior which
                // overwrites it. If it is desired to update the boa engine to a newer version in
                // the future, an alternative to this will be needed.
                ctx.register_global_property("for_each", x, Attribute::READONLY);
                Ok(self
                    .r#where
                    .as_ref()
                    .map_or(Ok(true), |w| {
                        Ok(ctx.execute(w.clone()).map_err(ExecutionError)?.to_boolean())
                    })?
                    .then(|| self.select.select(ctx).map_err(ExecutionError)))
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .map(|x| {
                x.and_then(|v| {
                    purge_undefined(&v, ctx).map_err(EvalExprErrorInner::InvalidResultJson)
                })
            })
            .collect_vec()
            .into_iter())
    }
}

/// Defines the structure of a select.
///
/// Initially deserialized as strings, but those terminal strings are eventually compiled to the
/// codeblocks
#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
#[serde(untagged)]
#[derive(serde::Serialize)]
enum Select<T = Gc<CodeBlock>> {
    /// String that gets compiled into bytecode
    Expr(T),
    Map(BTreeMap<Arc<str>, Self>),
    List(Vec<Self>),
    Int(i64),
}

impl SelectTmp {
    /// converts temporary to queryable by compiling any String terminal into bytecode
    fn compile(&self, ctx: &mut Context) -> Result<Select, QueryGenError> {
        match self {
            Self::Expr(src) => compile(src, ctx).map(Select::Expr),
            Self::Map(m) => m
                .iter()
                .map(|(k, v)| v.compile(ctx).map(|v| (k.clone(), v)))
                .collect::<Result<BTreeMap<_, _>, _>>()
                .map(Select::Map),
            Self::List(l) => l
                .iter()
                .map(|v| v.compile(ctx))
                .collect::<Result<Vec<_>, _>>()
                .map(Select::List),
            Self::Int(i) => Ok(Select::Int(*i)),
        }
    }
}

impl Select {
    fn select(&self, ctx: &mut Context) -> JsResult<JsValue> {
        match self {
            Self::Expr(code) => ctx.execute(code.clone()),
            Self::Map(m) => {
                let m: BTreeMap<Arc<str>, JsValue> = m
                    .iter()
                    .map(|(k, v)| Ok((k.clone(), v.select(ctx)?)))
                    .collect::<JsResult<_>>()?;
                let mut obj = ObjectInitializer::new(ctx);
                for (k, v) in m {
                    obj.property(k.to_string(), v, Attribute::READONLY);
                }

                Ok(obj.build().into())
            }
            Self::List(l) => l
                .iter()
                .map(|v| v.select(ctx))
                .collect::<JsResult<Vec<JsValue>>>()
                .map(|arr| JsArray::from_iter(arr, ctx).into()),
            Self::Int(i) => Ok(JsValue::Integer(*i as i32)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // testing cases are taken from the book

    #[test]
    fn test_queries() {
        let q = QueryTmp {
            select: SelectTmp::Expr(Arc::from("response.body.session".to_owned())),
            r#where: Some("response.status < 400".to_owned()),
            for_each: vec![],
        };
        let q = QueryInner::try_from(Rc::new(q)).unwrap();
        let response = serde_json::json! { {"body": {"session": "abc123"}, "status": 200} };
        let res = q
            .query(Arc::new(serde_json::json!({ "response": response })))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(res, vec![SJVal::String("abc123".to_owned())]);

        let q = QueryInner::try_from(Rc::new(QueryTmp {
            select: SelectTmp::Map(
                [(
                    Arc::from("name".to_owned()),
                    SelectTmp::Expr(Arc::from("for_each[0].name".to_owned())),
                )]
                .into(),
            ),
            r#where: Some("true".to_owned()),
            for_each: vec!["response.body.characters".to_owned()],
        }))
        .unwrap();
        let response = serde_json::json! {
            {"body":    {
          "characters": [
            {
              "type": "Human",
              "id": "1000",
              "name": "Luke Skywalker",
              "friends": ["1002", "1003", "2000", "2001"],
              "appearsIn": [4, 5, 6],
              "homePlanet": "Tatooine",
            },
            {
              "type": "Human",
              "id": "1001",
              "name": "Darth Vader",
              "friends": ["1004"],
              "appearsIn": [4, 5, 6],
              "homePlanet": "Tatooine",
            },
            {
              "type": "Droid",
              "id": "2001",
              "name": "R2-D2",
              "friends": ["1000", "1002", "1003"],
              "appearsIn": [4, 5, 6],
              "primaryFunction": "Astromech",
            }
          ]
        }

        }};
        let res = q
            .query(Arc::new(serde_json::json!({ "response": response })))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            res,
            vec![
                serde_json::json!({"name": "Luke Skywalker"}),
                serde_json::json!({"name": "Darth Vader"}),
                serde_json::json!({"name": "R2-D2"})
            ]
        );
    }
}
