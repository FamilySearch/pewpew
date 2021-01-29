use config::{LoadTest, Provider};
use js_sys::Map;
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};

#[wasm_bindgen]
pub struct Config(LoadTest);

#[wasm_bindgen]
impl Config {
    // build a config object from raw bytes (in javascript this is passing in a Uint8Array)
    #[wasm_bindgen(constructor)]
    pub fn from_bytes(bytes: &[u8], env_vars: Map) -> Result<Config, JsValue> {
        let env_vars = serde_wasm_bindgen::from_value(env_vars.into())?;
        let load_test = LoadTest::from_config(bytes, &Default::default(), &env_vars)
            .map_err(|e| JsValue::from_str(&format!("{:?}", e)))?;
        Ok(Config(load_test))
    }

    // return the duration of the test in seconds
    #[wasm_bindgen(js_name = getDuration)]
    pub fn get_duration(&self) -> u64 {
        self.0.get_duration().as_secs()
    }

    // return a string array of logger files
    #[wasm_bindgen(js_name = getLoggerFiles)]
    pub fn get_logger_files(&self) -> Box<[JsValue]> {
        self.0
            .loggers
            .iter()
            .map(|(_, l)| l.to.as_str().into())
            .collect::<Vec<_>>()
            .into_boxed_slice()
    }

    // return the bucket size for the test
    #[wasm_bindgen(js_name = getBucketSize)]
    pub fn get_bucket_size(&self) -> u64 {
        self.0.config.general.bucket_size.as_secs()
    }

    // return a string array of files used to feed providers
    #[wasm_bindgen(js_name = getInputFiles)]
    pub fn get_input_files(&self) -> Box<[JsValue]> {
        self.0
            .providers
            .iter()
            .filter_map(|(_, v)| {
                if let Provider::File(f) = v {
                    Some(f.path.as_str().into())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .into_boxed_slice()
    }

    // returns nothing if the config file has no errors, throws an error containing a string description, if the config file has errors
    #[wasm_bindgen(js_name = checkOk)]
    pub fn check_ok(&self) -> Result<(), JsValue> {
        self.0
            .ok_for_loadtest()
            .map_err(|e| JsValue::from_str(&format!("{:?}", e)))
    }
}
