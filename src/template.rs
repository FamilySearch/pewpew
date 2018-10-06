use crate::request::TemplateValues;
use handlebars::{
    Context,
    Handlebars,
    Helper,
    HelperResult,
    Output,
    Renderable,
    RenderContext,
    template::{HelperTemplate, Parameter, Template, TemplateElement},
};
use jsonpath::Selector as JsonPath;
use regex::Regex;
use serde_json::Value as JsonValue;

use std::sync::Arc;

pub type TextifyReturnFn = dyn (Fn(&TemplateValues) -> JsonValue) + Send + Sync;

pub fn textify(string: String, handlebars: Arc<Handlebars>, force_stringify: bool)
    -> (Box<TextifyReturnFn>, Vec<String>)
{
    let mut params = Vec::new();
    let mut t = Template::compile(&string).expect("invalid template");
    let elements_len = t.elements.len();
    for el in &mut t.elements {
        match el {
            TemplateElement::RawString(_) => (),
            TemplateElement::Expression(ref param) => {
                match param {
                    Parameter::Name(n) => {
                        let object_name_re = Regex::new(r"^([^.]*)").unwrap();
                        let param_name = object_name_re.captures(n).unwrap()
                            .get(1).expect("invalid json path query")
                            .as_str().into();
                        if force_stringify {
                            let ht = HelperTemplate {
                                name: "stringify".to_string(),
                                params: vec!(Parameter::Name(n.clone())),
                                hash: Default::default(),
                                block_param: None,
                                template: None,
                                inverse: None, 
                                block: false,
                            };
                            *el = TemplateElement::HelperExpression(Box::new(ht));
                        }
                        params.push(param_name)
                    },
                    _ => panic!("unsupported template syntax")
                }
            },
            TemplateElement::HelperExpression(ref mut helper) if !helper.block => {
                match helper.name.as_ref() {
                    "json" => {
                        // TODO: relax this limitation
                        if elements_len > 1 {
                            panic!("json helper must be the only value in template")
                        }
                        let (mut closure, param) = create_json_helper(helper);
                        if force_stringify {
                            closure = Box::new(move |d: &TemplateValues| {
                                let v = closure(d);
                                JsonValue::String(json_value_to_string(&v).to_string())
                            });
                        }
                        return (closure, vec!(param))
                    },
                    _ => panic!("unknown template helper `{}`", helper.name)
                }
            },
            _ => panic!("unsupported template syntax, {:?}", el)
        }
    }
    let ret_fn: Box<TextifyReturnFn> = if params.is_empty() {
        Box::new(move |_| JsonValue::String(string.clone()))
    } else {
        Box::new(
            move |d| {
                let ctx = Context::wraps(d.as_json()).expect("could not render template");
                let mut render_context = RenderContext::new(None);
                let s = t.renders(&handlebars, &ctx, &mut render_context)
                    .unwrap_or_else(|e| panic!("could not render template, {}, {}", string, e));
                JsonValue::String(s)
            }
        )
    };
    (ret_fn, params)
}

pub fn stringify_helper(h: &Helper<'_, '_>, _: &Handlebars, _: &Context, _: &mut RenderContext<'_>, out: &mut dyn Output) -> HelperResult {
    let param = h.param(0).expect("missing stringify param");
    out.write(&json_value_to_string(param.value()))?;
    Ok(())
}

// not a standard handlebars helper. This bypasses handlebars resolution of templates, pre-compiles the json path
// query and returns a function which will execute the compiled json path with the given context
fn create_json_helper(t: &HelperTemplate) -> (Box<TextifyReturnFn>, String) {
    let query = &t.params[0];
    // handle the case if the json path query is quoted as a string or not
    let json_path = match query {
        Parameter::Literal(l) => {
            match l {
                JsonValue::String(s) => s,
                _ => panic!("invalid json path query {:?}", l)
            }
        },
        _ => panic!("invalid json path query {:?}", query)
    };
    let single_element = t.params.len() == 2;
    let object_name_re = Regex::new(r"^([^\[.]*)").unwrap();
    let param_name = object_name_re.captures(json_path).unwrap()
        .get(1).expect("invalid json path query")
        .as_str().into();

    // jsonpath requires the query to start with `$.`, so add it in
    let json_path = format!("$.{}", json_path);

    let json_path = JsonPath::new(&json_path).unwrap_or_else(|e| panic!("invalid json path query, {}\n{:?}", json_path, e));
    let ret_fn = move |d: &TemplateValues| {
        let mut result = json_path.find(d.as_json());
        if single_element {
            if let Some(v) = result.nth(0) {
                v.clone()
            } else {
                JsonValue::Null
            }
        } else {
            JsonValue::Array(result.cloned().collect())
        }
    };
    (Box::new(ret_fn), param_name)
}

pub fn textify_json(json_in: JsonValue, handlebars: Arc<Handlebars>)
    -> (Box<TextifyReturnFn>, Vec<String>)
{
    let mut provider_names = Vec::new();
    let ret_fn: Box<TextifyReturnFn> = match json_in {
        JsonValue::Null => Box::new(|_| JsonValue::Null),
        JsonValue::Bool(b) => Box::new(move |_| JsonValue::Bool(b)),
        JsonValue::Number(n) => Box::new(move |_| JsonValue::Number(n.clone())),
        JsonValue::String(s) => {
            let (t, pn) = textify(s, handlebars, false);
            provider_names.extend(pn);
            t
        },
        JsonValue::Array(array) => {
            let mut vec = Vec::new();
            for v in array {
                let (e_fn, pn) = textify_json(v, handlebars.clone());
                provider_names.extend(pn);
                vec.push(e_fn);
            }
            let a_fn = move |d: &TemplateValues| {
                JsonValue::Array(vec.iter().map(|f| f(d)).collect())
            };
            Box::new(a_fn)
        },
        JsonValue::Object(map) => {
            let mut new_map = Vec::new();
            for (k, v) in map {
                let (key, pn) = textify(k, handlebars.clone(), false);
                provider_names.extend(pn);
                let (value, pn) = textify_json(v, handlebars.clone());
                provider_names.extend(pn);
                new_map.push((key, value));
            }
            let o_fn = move |d: &TemplateValues| {
                let map = new_map.iter().map(|(k, v)| {
                    if let JsonValue::String(s) = k(d) {
                        (s, v(d))
                    } else {
                        panic!("a non-string value cannot be used as a json object's key")
                    }
                }).collect();
                JsonValue::Object(map)
            };
            Box::new(o_fn)
        }
    };
    (ret_fn, provider_names)
}

pub fn json_value_to_string (v: &JsonValue) -> String {
    match v {
        JsonValue::String(s) => s.clone(),
        _ => v.to_string()
    }
}

#[cfg(test)]
mod tests {
    use handlebars::Handlebars;
    use lazy_static::lazy_static;
    use serde_json::{json, Value as JsonValue};
    use super::*;

    use std::sync::Arc;

    lazy_static! {
        static ref TEMPLATES: Vec<JsonValue> = vec!(
            json!({
                "foo": "{{val1}}",
                "bar": {
                    "abc":"{{val2}}"
                }
            }),
            json!("{{json \"a.*.id\"}}"),
            json!("{{json \"b\" true}}"),
        );
        static ref DATA: Vec<TemplateValues> = vec!(
            json!({
                "val1": "it",
                "val2": "works"
            }),
            json!({
                "a": [
                    { "id": 1 },
                    { "id": 2 },
                    { "id": 3 }
                ],
                "b": {
                    "x": 1,
                    "y": 1,
                    "z": 1,
                }
            }),
        ).into_iter().map(Into::into).collect();
        static ref EXPECTS: Vec<JsonValue> = vec!(
            json!({
                "foo": "it",
                "bar": {
                    "abc":"works"
                }
            }),
            json!([1, 2, 3]),
            json!({
                "x": 1,
                "y": 1,
                "z": 1,
            }),
        );
    }

    fn get_handlebars () -> Handlebars {
        let mut handlebars = Handlebars::new();
        handlebars.set_strict_mode(true);
        handlebars
    }


    #[test]
    fn textified_json_renders_properly() {
        let handlebars = get_handlebars();
        let (t, _) = textify_json(TEMPLATES[0].clone(), Arc::new(handlebars));
        let result = t(&DATA[0]);
        assert_eq!(result, EXPECTS[0]);
    }

    #[test]
    fn json_path_evaluates() {
        let handlebars = get_handlebars();
        let s = if let JsonValue::String(ref s) = TEMPLATES[1] {
            s.clone()
        } else {
            unreachable!();
        };
        let (t, _) = textify(s, Arc::new(handlebars), false);
        let result = t(&DATA[1]);
        assert_eq!(result, EXPECTS[1]);
    }

    #[test]
    fn json_path_gets_correct_name() {
        let handlebars = get_handlebars();
        let s = if let JsonValue::String(ref s) = TEMPLATES[1] {
            s.clone()
        } else {
            unreachable!();
        };
        let (_, name) = textify(s, Arc::new(handlebars), false);
        assert_eq!(name, vec!("a"));
    }

    #[test]
    fn json_path_single_element() {
        let handlebars = get_handlebars();
        let s = if let JsonValue::String(ref s) = TEMPLATES[2] {
            s.clone()
        } else {
            unreachable!();
        };
        let (t, _) = textify(s, Arc::new(handlebars), false);
        let result = t(&DATA[1]);
        assert_eq!(result, EXPECTS[2]);
    }

    #[should_panic]
    #[test]
    fn json_path_should_panic_if_not_alone() {
        let handlebars = get_handlebars();
        textify("foo{{json \"*\"}}".into(), Arc::new(handlebars), false);
    }

    #[test]
    fn json_value_to_string_works() {
        let expect = r#"{"foo":123}"#;
        let json = json!({"foo": 123});
        assert_eq!(json_value_to_string(&json), expect);

        let expect = r#"asdf " foo"#;
        let json = expect.to_string().into();
        assert_eq!(json_value_to_string(&json), expect);

        let expect = r#"["foo",1,2,3,null]"#;
        let json = json!(["foo", 1, 2, 3, null]);
        assert_eq!(json_value_to_string(&json), expect);
    }
}