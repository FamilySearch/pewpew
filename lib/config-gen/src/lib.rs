use config::templating::False;
use wasm_bindgen::prelude::*;

pub type LoadTest = config::LoadTest<False, False>;

#[wasm_bindgen]
pub fn load_test_yaml_from_js(data: &str) -> Result<String, JsError> {
    console_error_panic_hook::set_once();
    let lt: LoadTest = serde_json::from_str(data)?;
    let yaml = serde_yaml::to_string(&lt)?;
    Ok(yaml)
}
