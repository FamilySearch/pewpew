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
use regex::Regex;
use serde_json::Value as JsonValue;

use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

pub type TextifyReturnFn = dyn (Fn(&TemplateValues) -> JsonValue) + Send + Sync;

pub fn textify(string: String, handlebars: Arc<Handlebars>, force_stringify: bool)
    -> (Box<TextifyReturnFn>, Vec<String>)
{
    let mut params = Vec::new();
    let mut t = Template::compile(&string).expect("invalid template");
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
                    "epoch" | "join" => (),
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
        JsonValue::Array(v) => 
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

pub fn json_value_to_string (v: &JsonValue) -> String {
    match v {
        JsonValue::String(s) => s.clone(),
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
}