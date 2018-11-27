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
use regex::Regex;
use serde_json as json;

use std::{
    collections::BTreeMap,
    ops::{Deref, DerefMut},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};


#[derive(Debug)]
pub struct TemplateValues(json::Value);

impl TemplateValues {
    pub fn new () -> Self {
        TemplateValues(json::Value::Object(json::Map::new()))
    }

    pub fn as_json (&self) -> &json::Value {
        &self.0
    }
}

impl Deref for TemplateValues {
    type Target = json::Map<String, json::Value>;

    fn deref (&self) -> &Self::Target {
        match &self.0 {
            json::Value::Object(o) => o,
            _ => panic!("cannot deref json value as object")
        }
    }
}

impl DerefMut for TemplateValues {
    fn deref_mut (&mut self) -> &mut json::Map<String, json::Value> {
        match &mut self.0 {
            json::Value::Object(o) => o,
            _ => panic!("cannot deref json value as object")
        }
    }
}

impl From<json::Value> for TemplateValues {
    fn from (map: json::Value) -> Self {
        TemplateValues(map)
    }
}

pub type TextifyReturnFn = dyn (Fn(&TemplateValues) -> json::Value) + Send + Sync;

pub fn textify(string: String, handlebars: Arc<Handlebars>, static_providers: &BTreeMap<String, json::Value>)
    -> (Box<TextifyReturnFn>, Vec<String>)
{
    let mut params = Vec::new();
    let mut t = Template::compile(&string).expect("invalid template");
    let mut string2 = Some("".to_string());
    for el in &mut t.elements {
        match el {
            TemplateElement::RawString(s) => {
                string2 = string2.map(|mut s2| {
                    s2.push_str(s);
                    s2
                });
            },
            TemplateElement::Expression(ref param) => {
                match param {
                    Parameter::Name(n) => {
                        let object_name_re = Regex::new(r"^([^.]*)").unwrap();
                        let param_name: String = object_name_re.captures(n).unwrap()
                            .get(1).expect("invalid provider reference")
                            .as_str().into();
                        // if the referenced value is a static provider, resolve it now
                        if let Some(json) = static_providers.get(&param_name) {
                            let mut t = Template::new(false);
                            t.elements.push(el.to_owned());
                            let ctx = Context::wraps(json::json!({ param_name: json_value_to_string(json) })).expect("could not render template");
                            let mut render_context = RenderContext::new(None);
                            let s = t.renders(&handlebars, &ctx, &mut render_context)
                                .unwrap_or_else(|e| panic!("could not render template, {}, {}", string, e));
                            string2 = string2.map(|mut s2| {
                                s2.push_str(&s);
                                s2
                            });
                            *el = TemplateElement::RawString(s);
                        } else {
                            // force the value to be stringified (which prevents text like "[Object object]" showing up)
                            let ht = HelperTemplate {
                                name: "stringify".to_string(),
                                params: vec!(Parameter::Name(n.clone())),
                                hash: Default::default(),
                                block_param: None,
                                template: None,
                                inverse: None, 
                                block: false,
                            };
                            string2 = None;
                            *el = TemplateElement::HelperExpression(Box::new(ht));
                            params.push(param_name);
                        }
                    },
                    _ => panic!("unsupported template syntax")
                }
            },
            TemplateElement::HelperExpression(ref helper) if !helper.block => {
                match (helper.name.as_ref(), helper.params.as_slice()) {
                    ("epoch", []) => (),
                    ("join", [Parameter::Name(param_name), Parameter::Literal(json::Value::String(_))]) => {
                        if let Some(json) = static_providers.get(param_name) {
                            let mut t = Template::new(false);
                            t.elements.push(el.to_owned());
                            let param_name: &str = param_name.as_ref();
                            let ctx = Context::wraps(json::json!({ param_name: json })).expect("could not render template");
                            let mut render_context = RenderContext::new(None);
                            let s = t.renders(&handlebars, &ctx, &mut render_context)
                                .unwrap_or_else(|e| panic!("could not render template, {}, {}", string, e));
                            string2 = string2.map(|mut s2| {
                                s2.push_str(&s);
                                s2
                            });
                            *el = TemplateElement::RawString(s);
                        } else {
                            string2 = None;
                            params.push(param_name.clone());
                        }
                    },
                    _ => panic!("unknown template helper or invalid syntax `{}`", helper.name)
                }
            },
            _ => panic!("unsupported template syntax, {:?}", el)
        }
    }
    let ret_fn: Box<TextifyReturnFn> = if let Some(s) = string2 {
        Box::new(move |_| json::Value::String(s.clone()))
    } else {
        Box::new(
            move |d| {
                let ctx = Context::wraps(d.as_json()).expect("could not render template");
                let mut render_context = RenderContext::new(None);
                let s = t.renders(&handlebars, &ctx, &mut render_context)
                    .unwrap_or_else(|e| panic!("could not render template, {}, {}", string, e));
                json::Value::String(s)
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

pub fn epoch_helper(_: &Helper<'_, '_>, _: &Handlebars, _: &Context, _: &mut RenderContext<'_>, out: &mut dyn Output) -> HelperResult {
    let start = SystemTime::now();
    let since_the_epoch = start.duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    let in_ms = since_the_epoch.as_secs() * 1000 +
        u64::from(since_the_epoch.subsec_nanos()) / 1_000_000;
    out.write(&in_ms.to_string())?;
    Ok(())
}

pub fn join_helper(h: &Helper<'_, '_>, _: &Handlebars, _: &Context, _: &mut RenderContext<'_>, out: &mut dyn Output) -> HelperResult {
    let json = h.param(0).expect("missing join param").value();
    let joiner = json_value_to_string(
        h.param(1).expect("missing join param").value()
    );
    let output = match json {
        json::Value::Array(v) => 
            v.iter()
                .map(json_value_to_string)
                .collect::<Vec<_>>()
                .as_slice()
                .join(&joiner),
        _ => json_value_to_string(json)
    };
    out.write(&output)?;
    Ok(())
}

pub fn json_value_to_string (v: &json::Value) -> String {
    match v {
        json::Value::String(s) => s.clone(),
        _ => v.to_string()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use super::*;

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

    #[test]
    fn gets_provider_names() {
        let handlebars = Arc::new(Handlebars::new());
        let static_providers = BTreeMap::new();

        let checks: Vec<(&str, Vec<String>)> = vec!(
            ("foo{{bar}}", ["bar"].iter().map(|s| s.to_string()).collect()),
            ("{{bar.baz}}", ["bar"].iter().map(|s| s.to_string()).collect()),
            ("{{foo}}{{bar}}", ["foo", "bar"].iter().map(|s| s.to_string()).collect()),
            (r#"{{join foo "-"}}"#, ["foo"].iter().map(|s| s.to_string()).collect()),
        );

        for (i, (s, expects)) in checks.into_iter().enumerate() {
            let (_, providers) = textify(s.to_string(), handlebars.clone(), &static_providers);
            assert_eq!(expects, providers, "index {}", i);
        }
    }
    

    #[test]
    fn static_replacement() {
        let mut handlebars = Handlebars::new();
        handlebars.register_helper("join", Box::new(join_helper));
        handlebars.set_strict_mode(true);
        let handlebars = Arc::new(handlebars);
        let template_values = TemplateValues::new();

        let checks: Vec<(&str, json::Value, &str)> = vec!(
            ("foo{{bar}}", json::json!({"bar": "bar"}), "foobar"),
            (r#"{{join bar ","}}"#, json::json!({"bar": [1, 2, 3]}), "1,2,3"),
        );

        for (i, (template, j, expect)) in checks.into_iter().enumerate() {
            let b = if let json::Value::Object(map) = j {
                map.into_iter().collect()
            } else {
                unreachable!()
            };
            let (template, providers) = textify(template.to_string(), handlebars.clone(), &b);
            assert!(providers.is_empty(), "index {}", i);
            assert_eq!(template(&template_values), expect, "index {}", i);
        }
    }
}