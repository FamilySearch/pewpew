use serde_json as json;

use std::{borrow::Cow, path::Path};

pub fn str_to_json(s: &str) -> json::Value {
    json::from_str(s).unwrap_or_else(|_| json::Value::String(s.into()))
}

pub fn json_value_to_string(v: Cow<'_, json::Value>) -> Cow<'_, String> {
    match v {
        Cow::Owned(json::Value::String(s)) => Cow::Owned(s),
        Cow::Borrowed(json::Value::String(s)) => Cow::Borrowed(s),
        _ => Cow::Owned(v.to_string()),
    }
}

pub fn tweak_path(rest: &mut String, base: &Path) {
    *rest = base.with_file_name(&rest).to_string_lossy().into();
}

pub fn config_limit_to_channel_limit(limit: config::Limit) -> channel::Limit {
    match limit {
        config::Limit::Dynamic(n) => channel::Limit::dynamic(n),
        config::Limit::Static(n) => channel::Limit::statik(n),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_value_to_string_works() {
        let expect = r#"{"foo":123}"#;
        let json = json::json!({"foo": 123});
        assert_eq!(json_value_to_string(Cow::Borrowed(&json)).as_str(), expect);
        assert_eq!(json_value_to_string(Cow::Owned(json)).as_str(), expect);

        let expect = r#"asdf " foo"#;
        let json = expect.to_string().into();
        assert_eq!(json_value_to_string(Cow::Borrowed(&json)).as_str(), expect);
        assert_eq!(json_value_to_string(Cow::Owned(json)).as_str(), expect);

        let expect = r#"["foo",1,2,3,null]"#;
        let json = json::json!(["foo", 1, 2, 3, null]);
        assert_eq!(json_value_to_string(Cow::Borrowed(&json)).as_str(), expect);
        assert_eq!(json_value_to_string(Cow::Owned(json)).as_str(), expect);
    }
}
