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
use unicode_segmentation::UnicodeSegmentation;

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
                    ("epoch", [Parameter::Literal(json::Value::String(s))]) if s == "s" || s == "ms" || s == "mu" || s == "ns" => {
                        string2 = None;
                    },
                    ("join", [Parameter::Name(param_name), Parameter::Literal(json::Value::String(_))])
                    | ("start_pad", [Parameter::Name(param_name), Parameter::Literal(json::Value::Number(_)), Parameter::Literal(json::Value::String(_))])
                    | ("end_pad", [Parameter::Name(param_name), Parameter::Literal(json::Value::Number(_)), Parameter::Literal(json::Value::String(_))])
                    | ("encode", [Parameter::Name(param_name), Parameter::Literal(json::Value::String(_))])=> {
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

pub fn epoch_helper(h: &Helper<'_, '_>, _: &Handlebars, _: &Context, _: &mut RenderContext<'_>, out: &mut dyn Output) -> HelperResult {
    let start = SystemTime::now();
    let since_the_epoch = start.duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    let n = match h.param(0).expect("missing epoch param").value().as_str() {
        Some("s") =>  u128::from(since_the_epoch.as_secs()),
        Some("ms") => since_the_epoch.as_millis(),
        Some("mu") => since_the_epoch.as_micros(),
        Some("ns") => since_the_epoch.as_nanos(),
        _ => unreachable!("epoch parameter should always be 's', 'ms', 'mu', or 'ns'")
    };
    out.write(&n.to_string())?;
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

pub fn pad_helper(h: &Helper<'_, '_>, _: &Handlebars, _: &Context, _: &mut RenderContext<'_>, out: &mut dyn Output) -> HelperResult {
    let mut string_to_pad = json_value_to_string(
        &h.param(0).expect("missing start_pad param")
            .value()
    );
    let desired_length = h.param(1).expect("missing start_pad param")
        .value().as_u64().expect("invalid start_pad param") as usize;
    let pad_str = json_value_to_string(
        &h.param(2).expect("missing start_pad param")
            .value()
    );
    let str_len = string_to_pad.as_str().graphemes(true).count();
    let diff = desired_length.saturating_sub(str_len);
    let mut pad_str: String = pad_str.as_str().graphemes(true)
        .cycle()
        .take(diff)
        .collect();
    let output = if h.name() == "start_pad" {
        pad_str.push_str(&string_to_pad);
        pad_str
    } else {
        string_to_pad.push_str(&pad_str);
        string_to_pad
    };
    out.write(&output)?;
    Ok(())
}

pub fn encode_helper(h: &Helper<'_, '_>, _: &Handlebars, _: &Context, _: &mut RenderContext<'_>, out: &mut dyn Output) -> HelperResult {
    let string_to_encode = json_value_to_string(
        &h.param(0).expect("missing encode param")
            .value()
    );
    let encoding = h.param(1).expect("missing encode param")
        .value().as_str().expect("invalid encode param");

    let output = match encoding {
        "percent" =>
            percent_encoding::utf8_percent_encode(&string_to_encode, percent_encoding::DEFAULT_ENCODE_SET).to_string(),
        "percent-path" =>
            percent_encoding::utf8_percent_encode(&string_to_encode, percent_encoding::PATH_SEGMENT_ENCODE_SET).to_string(),
        "percent-query" =>
            percent_encoding::utf8_percent_encode(&string_to_encode, percent_encoding::QUERY_ENCODE_SET).to_string(),
        "percent-simple" =>
            percent_encoding::utf8_percent_encode(&string_to_encode, percent_encoding::SIMPLE_ENCODE_SET).to_string(),
        "percent-userinfo" =>
            percent_encoding::utf8_percent_encode(&string_to_encode, percent_encoding::USERINFO_ENCODE_SET).to_string(),
        _ => panic!("unknown encoding `{}`", encoding)
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
        handlebars.register_helper("epoch", Box::new(epoch_helper));
        handlebars.register_helper("start_pad", Box::new(pad_helper));
        handlebars.register_helper("end_pad", Box::new(pad_helper));
        handlebars.register_helper("encode", Box::new(encode_helper));
        handlebars.set_strict_mode(true);
        let handlebars = Arc::new(handlebars);
        let template_values = TemplateValues::new();
        let now = SystemTime::now().duration_since(UNIX_EPOCH)
            .expect("Time went backwards").as_secs();
        let epoch_string = format!("epoch {}", now / 100);

        let checks = vec!(
            ("foo{{bar}}", json::json!({"bar": "bar"}), "foobar", false),
            (r#"epoch {{epoch "s"}}"#, json::json!({}), &epoch_string, true),
            (r#"{{join bar ","}}"#, json::json!({"bar": [1, 2, 3]}), "1,2,3", false),
            (r#"{{start_pad bar 6 "0"}}"#, json::json!({"bar": "asd"}), "000asd", false),
            (r#"{{start_pad bar 5 "123"}}"#, json::json!({"bar": "asd"}), "12asd", false),
            (r#"{{start_pad bar 2 "123"}}"#, json::json!({"bar": "asd"}), "asd", false),
            (r#"{{end_pad bar 6 "0"}}"#, json::json!({"bar": "asd"}), "asd000", false),
            (r#"{{end_pad bar 5 "123"}}"#, json::json!({"bar": "asd"}), "asd12", false),
            (r#"{{end_pad bar 2 "123"}}"#, json::json!({"bar": "asd"}), "asd", false),
            (r#"{{encode bar "percent"}}"#, json::json!({"bar": "asd jkl%"}), "asd%20jkl%", false),
            (r#"{{encode bar "percent-path"}}"#, json::json!({"bar": "asd/jkl%"}), "asd%2Fjkl%25", false),
            (r#"{{encode bar "percent-simple"}}"#, json::json!({"bar": "asd\njkl#"}), "asd%0Ajkl#", false),
            (r#"{{encode bar "percent-query"}}"#, json::json!({"bar": "asd\njkl{"}), "asd%0Ajkl{", false),
            (r#"{{encode bar "percent-userinfo"}}"#, json::json!({"bar": "asd jkl|"}), "asd%20jkl%7C", false),
        );

        for (i, (template, j, expect, starts_with)) in checks.into_iter().enumerate() {
            let b = if let json::Value::Object(map) = j {
                map.into_iter().collect()
            } else {
                unreachable!()
            };
            let (template, providers) = textify(template.to_string(), handlebars.clone(), &b);
            assert!(providers.is_empty(), "index {}", i);
            let left = template(&template_values);
            if starts_with {
                assert!(json_value_to_string(&left).starts_with(expect), "index {}, left {} == right {}", i, left, expect);
            } else {
                assert_eq!(left, expect, "index {}", i);
            }
        }
    }
}