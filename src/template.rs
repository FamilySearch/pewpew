use crate::util::parse_provider_name;
use handlebars::{
    template::{HelperTemplate, Parameter, Template, TemplateElement},
    Context, Handlebars, Helper, HelperResult, Output, RenderContext, Renderable,
};
use serde_json as json;
use unicode_segmentation::UnicodeSegmentation;

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    ops::{Deref, DerefMut},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug)]
pub struct TemplateValues(json::Value);

impl TemplateValues {
    pub fn new() -> Self {
        TemplateValues(json::Value::Object(json::Map::new()))
    }

    pub fn as_json(&self) -> &json::Value {
        &self.0
    }
}

impl Deref for TemplateValues {
    type Target = json::Map<String, json::Value>;

    fn deref(&self) -> &Self::Target {
        match &self.0 {
            json::Value::Object(o) => o,
            _ => panic!("cannot deref json value as object"),
        }
    }
}

impl DerefMut for TemplateValues {
    fn deref_mut(&mut self) -> &mut json::Map<String, json::Value> {
        match &mut self.0 {
            json::Value::Object(o) => o,
            _ => panic!("cannot deref json value as object"),
        }
    }
}

impl From<json::Value> for TemplateValues {
    fn from(map: json::Value) -> Self {
        TemplateValues(map)
    }
}

pub type TextifyReturnFn = dyn (Fn(&json::Value) -> json::Value) + Send + Sync;

pub enum TextifyReturn {
    Trf(Box<TextifyReturnFn>),
    String(String),
}

impl TextifyReturn {
    pub fn to_string(&self, value: &json::Value) -> String {
        match self {
            TextifyReturn::Trf(t) => json_value_to_string(&t(value)).into_owned(),
            TextifyReturn::String(s) => s.clone(),
        }
    }

    // is used in test
    #[allow(dead_code)]
    fn to_json(&self, value: &json::Value) -> json::Value {
        match self {
            TextifyReturn::Trf(t) => t(value),
            TextifyReturn::String(s) => s.as_str().into(),
        }
    }
}

pub fn textify(
    string: String,
    handlebars: Arc<Handlebars>,
    providers: &mut BTreeSet<String>,
    static_providers: &BTreeMap<String, json::Value>,
) -> TextifyReturn {
    let mut t = Template::compile(&string).expect("invalid template");
    let mut string2 = Some("".to_string());
    for el in &mut t.elements {
        match el {
            TemplateElement::RawString(s) => {
                string2 = string2.map(|mut s2| {
                    s2.push_str(s);
                    s2
                });
            }
            TemplateElement::Expression(ref param) => {
                match param {
                    Parameter::Name(n) => {
                        let param_name = parse_provider_name(n);
                        // if the referenced value is a static provider, resolve it now
                        if let Some(json) = static_providers.get(param_name) {
                            let mut t = Template::new(false);
                            t.elements.push(el.to_owned());
                            let ctx = Context::wraps(json::json!({
                                param_name: json_value_to_string(json)
                            }))
                            .expect("could not render template");
                            let mut render_context = RenderContext::new(None);
                            let s = t
                                .renders(&handlebars, &ctx, &mut render_context)
                                .unwrap_or_else(|e| {
                                    panic!("could not render template, {}, {}", string, e)
                                });
                            string2 = string2.map(|mut s2| {
                                s2.push_str(&s);
                                s2
                            });
                            *el = TemplateElement::RawString(s);
                        } else {
                            // force the value to be stringified (which prevents text like "[Object object]" showing up)
                            let ht = HelperTemplate {
                                name: "stringify".to_string(),
                                params: vec![Parameter::Name(n.clone())],
                                hash: Default::default(),
                                block_param: None,
                                template: None,
                                inverse: None,
                                block: false,
                            };
                            string2 = None;
                            providers.insert(param_name.into());
                            *el = TemplateElement::HelperExpression(Box::new(ht));
                        }
                    }
                    _ => panic!("unsupported template syntax"),
                }
            }
            TemplateElement::HelperExpression(ref helper) if !helper.block => {
                match (helper.name.as_ref(), helper.params.as_slice()) {
                    ("epoch", [Parameter::Literal(json::Value::String(s))])
                        if s == "s" || s == "ms" || s == "mu" || s == "ns" =>
                    {
                        string2 = None;
                    }
                    (
                        "join",
                        [Parameter::Name(param_name), Parameter::Literal(json::Value::String(_))],
                    )
                    | (
                        "start_pad",
                        [Parameter::Name(param_name), Parameter::Literal(json::Value::Number(_)), Parameter::Literal(json::Value::String(_))],
                    )
                    | (
                        "end_pad",
                        [Parameter::Name(param_name), Parameter::Literal(json::Value::Number(_)), Parameter::Literal(json::Value::String(_))],
                    )
                    | (
                        "encode",
                        [Parameter::Name(param_name), Parameter::Literal(json::Value::String(_))],
                    ) => {
                        let param_name = parse_provider_name(param_name);
                        if let Some(json) = static_providers.get(param_name) {
                            let mut t = Template::new(false);
                            t.elements.push(el.to_owned());
                            let ctx = Context::wraps(json::json!({ param_name: json }))
                                .expect("could not render template");
                            let mut render_context = RenderContext::new(None);
                            let s = t
                                .renders(&handlebars, &ctx, &mut render_context)
                                .unwrap_or_else(|e| {
                                    panic!("could not render template, {}, {}", string, e)
                                });
                            string2 = string2.map(|mut s2| {
                                s2.push_str(&s);
                                s2
                            });
                            *el = TemplateElement::RawString(s);
                        } else {
                            string2 = None;
                            providers.insert(param_name.into());
                        }
                    }
                    _ => panic!(
                        "unknown template helper or invalid syntax `{}`",
                        helper.name
                    ),
                }
            }
            _ => panic!("unsupported template syntax, {:?}", el),
        }
    }
    if let Some(s) = string2 {
        TextifyReturn::String(s)
    } else {
        let ret_fn: Box<TextifyReturnFn> = Box::new(move |d| {
            let ctx = Context::wraps(d).expect("could not render template");
            let mut render_context = RenderContext::new(None);
            let s = t
                .renders(&handlebars, &ctx, &mut render_context)
                .unwrap_or_else(|e| panic!("could not render template `{}`, {}", string, e));
            json::Value::String(s)
        });
        TextifyReturn::Trf(ret_fn)
    }
}

pub fn stringify_helper(
    h: &Helper<'_, '_>,
    _: &Handlebars,
    _: &Context,
    _: &mut RenderContext<'_>,
    out: &mut dyn Output,
) -> HelperResult {
    let param = h.param(0).expect("missing stringify param");
    out.write(&json_value_to_string(param.value()))?;
    Ok(())
}

pub fn epoch_helper(
    h: &Helper<'_, '_>,
    _: &Handlebars,
    _: &Context,
    _: &mut RenderContext<'_>,
    out: &mut dyn Output,
) -> HelperResult {
    let start = SystemTime::now();
    let since_the_epoch = start
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    let n = match h.param(0).expect("missing epoch param").value().as_str() {
        Some("s") => u128::from(since_the_epoch.as_secs()),
        Some("ms") => since_the_epoch.as_millis(),
        Some("mu") => since_the_epoch.as_micros(),
        Some("ns") => since_the_epoch.as_nanos(),
        _ => unreachable!("epoch parameter should always be 's', 'ms', 'mu', or 'ns'"),
    };
    out.write(&n.to_string())?;
    Ok(())
}

pub fn join_helper(
    h: &Helper<'_, '_>,
    _: &Handlebars,
    _: &Context,
    _: &mut RenderContext<'_>,
    out: &mut dyn Output,
) -> HelperResult {
    let json = h.param(0).expect("missing join param").value();
    let joiner = json_value_to_string(h.param(1).expect("missing join param").value());
    let output = match json {
        json::Value::Array(v) => {
            let string = v
                .iter()
                .map(|v| json_value_to_string(v).into_owned())
                .collect::<Vec<_>>()
                .as_slice()
                .join(&joiner);
            Cow::Owned(string)
        }
        _ => json_value_to_string(json),
    };
    out.write(output.as_str())?;
    Ok(())
}

pub fn pad_helper(
    h: &Helper<'_, '_>,
    _: &Handlebars,
    _: &Context,
    _: &mut RenderContext<'_>,
    out: &mut dyn Output,
) -> HelperResult {
    let string_to_pad = json_value_to_string(&h.param(0).expect("missing start_pad param").value());
    let desired_length = h
        .param(1)
        .expect("missing start_pad param")
        .value()
        .as_u64()
        .expect("invalid start_pad param") as usize;
    let pad_cow = json_value_to_string(&h.param(2).expect("missing start_pad param").value());
    let pad_str = pad_cow.as_str();
    let str_len = string_to_pad.graphemes(true).count();
    let diff = desired_length.saturating_sub(str_len);
    let mut pad_str: String = pad_str.graphemes(true).cycle().take(diff).collect();
    let output = if h.name() == "start_pad" {
        pad_str.push_str(&string_to_pad);
        pad_str
    } else {
        let mut string_to_pad = string_to_pad.into_owned();
        string_to_pad.push_str(pad_str.as_str());
        string_to_pad
    };
    out.write(&output)?;
    Ok(())
}

pub fn encode_helper(
    h: &Helper<'_, '_>,
    _: &Handlebars,
    _: &Context,
    _: &mut RenderContext<'_>,
    out: &mut dyn Output,
) -> HelperResult {
    let string_to_encode = json_value_to_string(&h.param(0).expect("missing encode param").value());
    let encoding = h
        .param(1)
        .expect("missing encode param")
        .value()
        .as_str()
        .expect("invalid encode param");

    let output = match encoding {
        "percent" => percent_encoding::utf8_percent_encode(
            &string_to_encode,
            percent_encoding::DEFAULT_ENCODE_SET,
        )
        .to_string(),
        "percent-path" => percent_encoding::utf8_percent_encode(
            &string_to_encode,
            percent_encoding::PATH_SEGMENT_ENCODE_SET,
        )
        .to_string(),
        "percent-query" => percent_encoding::utf8_percent_encode(
            &string_to_encode,
            percent_encoding::QUERY_ENCODE_SET,
        )
        .to_string(),
        "percent-simple" => percent_encoding::utf8_percent_encode(
            &string_to_encode,
            percent_encoding::SIMPLE_ENCODE_SET,
        )
        .to_string(),
        "percent-userinfo" => percent_encoding::utf8_percent_encode(
            &string_to_encode,
            percent_encoding::USERINFO_ENCODE_SET,
        )
        .to_string(),
        _ => panic!("unknown encoding `{}`", encoding),
    };

    out.write(&output)?;
    Ok(())
}

pub fn json_value_to_string(v: &json::Value) -> Cow<'_, String> {
    match v {
        json::Value::String(s) => Cow::Borrowed(s),
        _ => Cow::Owned(v.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_value_to_string_works() {
        let expect = r#"{"foo":123}"#;
        let json = json!({"foo": 123});
        assert_eq!(json_value_to_string(&json).as_str(), expect);

        let expect = r#"asdf " foo"#;
        let json = expect.to_string().into();
        assert_eq!(json_value_to_string(&json).as_str(), expect);

        let expect = r#"["foo",1,2,3,null]"#;
        let json = json!(["foo", 1, 2, 3, null]);
        assert_eq!(json_value_to_string(&json).as_str(), expect);
    }

    #[test]
    fn gets_provider_names() {
        let handlebars = Arc::new(Handlebars::new());
        let static_providers = BTreeMap::new();

        let checks: Vec<(&str, Vec<String>)> = vec![
            (
                "foo{{bar}}",
                ["bar"].iter().map(|s| s.to_string()).collect(),
            ),
            (
                "{{bar.baz}}",
                ["bar"].iter().map(|s| s.to_string()).collect(),
            ),
            (
                "{{foo}}{{bar}}",
                ["foo", "bar"].iter().map(|s| s.to_string()).collect(),
            ),
            (
                r#"{{join foo "-"}}"#,
                ["foo"].iter().map(|s| s.to_string()).collect(),
            ),
            (
                r#"{{join foo.bar "-"}}"#,
                ["foo"].iter().map(|s| s.to_string()).collect(),
            ),
        ];

        for (i, (s, expects)) in checks.into_iter().enumerate() {
            let mut providers = BTreeSet::new();
            textify(
                s.into(),
                handlebars.clone(),
                &mut providers,
                &static_providers,
            );
            let expects: BTreeSet<_> = expects.into_iter().collect();
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
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_secs();
        let epoch_string = format!("epoch {}", now / 100);

        let checks = vec![
            ("foo{{bar}}", json::json!({"bar": "bar"}), "foobar", false),
            // (
            //     "foo{{bar.bar}}",
            //     json::json!({"bar": {"bar": "bar"}}),
            //     "foobar",
            //     false,
            // ),
            (
                r#"epoch {{epoch "s"}}"#,
                json::json!({}),
                &epoch_string,
                true,
            ),
            (
                r#"{{join bar ","}}"#,
                json::json!({"bar": [1, 2, 3]}),
                "1,2,3",
                false,
            ),
            (
                r#"{{start_pad bar 6 "0"}}"#,
                json::json!({"bar": "asd"}),
                "000asd",
                false,
            ),
            (
                r#"{{start_pad bar 5 "123"}}"#,
                json::json!({"bar": "asd"}),
                "12asd",
                false,
            ),
            (
                r#"{{start_pad bar 2 "123"}}"#,
                json::json!({"bar": "asd"}),
                "asd",
                false,
            ),
            (
                r#"{{end_pad bar 6 "0"}}"#,
                json::json!({"bar": "asd"}),
                "asd000",
                false,
            ),
            (
                r#"{{end_pad bar 5 "123"}}"#,
                json::json!({"bar": "asd"}),
                "asd12",
                false,
            ),
            (
                r#"{{end_pad bar 2 "123"}}"#,
                json::json!({"bar": "asd"}),
                "asd",
                false,
            ),
            (
                r#"{{encode bar "percent"}}"#,
                json::json!({"bar": "asd jkl%"}),
                "asd%20jkl%",
                false,
            ),
            (
                r#"{{encode bar "percent-path"}}"#,
                json::json!({"bar": "asd/jkl%"}),
                "asd%2Fjkl%25",
                false,
            ),
            (
                r#"{{encode bar "percent-simple"}}"#,
                json::json!({"bar": "asd\njkl#"}),
                "asd%0Ajkl#",
                false,
            ),
            (
                r#"{{encode bar "percent-query"}}"#,
                json::json!({"bar": "asd\njkl{"}),
                "asd%0Ajkl{",
                false,
            ),
            (
                r#"{{encode bar "percent-userinfo"}}"#,
                json::json!({"bar": "asd jkl|"}),
                "asd%20jkl%7C",
                false,
            ),
        ];

        for (i, (template, j, expect, starts_with)) in checks.into_iter().enumerate() {
            let b = if let json::Value::Object(map) = j {
                map.into_iter().collect()
            } else {
                unreachable!()
            };
            let mut providers = BTreeSet::new();
            let left = textify(template.into(), handlebars.clone(), &mut providers, &b)
                .to_json(template_values.as_json());
            assert!(providers.is_empty(), "index {}", i);
            if starts_with {
                assert!(
                    json_value_to_string(&left).starts_with(expect),
                    "index {}, left {} == right {}",
                    i,
                    left,
                    expect
                );
            } else {
                assert_eq!(left, expect, "index {}", i);
            }
        }
    }
}
