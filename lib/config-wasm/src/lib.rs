use config::{BodyTemplate, LoadTest, Provider};
use js_sys::Map;
use log::{debug, LevelFilter};
use std::{path::PathBuf, str::FromStr};
use wasm_bindgen::{prelude::wasm_bindgen, throw_str, JsValue, UnwrapThrowExt};

// Only valid because we are using this in a WebAssembly context without threads.
// We can only initialize the logger once or it will spit out error logs every time we init the constructor
static mut LOGGING_INITIALIZED: bool = false;

fn default_log_level() -> LevelFilter {
    LevelFilter::Error
}

#[no_mangle]
fn set_logging_initialized() {
    unsafe { LOGGING_INITIALIZED = true };
}

#[no_mangle]
fn get_logging_initialized() -> bool {
    unsafe { LOGGING_INITIALIZED }
}

fn init_logging(log_level: Option<String>) {
    if !get_logging_initialized() {
        // Use a LevelFilter instead of Level so we can set it to "off"
        let mut level_filter = default_log_level();
        if let Some(level_string) = log_level {
            level_filter = match LevelFilter::from_str(&level_string) {
                Ok(val) => val,
                Err(err) => throw_str(&err.to_string()),
            }
        }
        let level = level_filter.to_level();
        // May be off
        if level.is_some() {
            wasm_logger::init(wasm_logger::Config::new(level.unwrap_throw()));
        }
        // If it's off, we still don't want to set again, once it's on, it's on
        set_logging_initialized();
    }
}

#[wasm_bindgen]
pub struct Config(LoadTest);

#[allow(clippy::unused_unit)]
#[wasm_bindgen]
impl Config {
    // build a config object from raw bytes (in javascript this is passing in a Uint8Array)
    #[wasm_bindgen(constructor)]
    pub fn from_bytes(
        bytes: &[u8],
        env_vars: Map,
        log_level: Option<String>,
    ) -> Result<Config, JsValue> {
        init_logging(log_level);
        let env_vars = serde_wasm_bindgen::from_value(env_vars.into())?;
        let load_test = LoadTest::from_config(bytes, &PathBuf::default(), &env_vars)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
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
            .values()
            .map(|l| l.to.as_str().into())
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
        // We also need to include file bodies so we can validate that we have those as well.
        // Endpoint file bodies - BodyTemplate(File)
        let mut body_files: Vec<JsValue> = self
            .0
            .endpoints
            .iter()
            .filter_map(|endpoint| {
                if let BodyTemplate::File(_, template) = &endpoint.body {
                    // The path is the base path, the template.pieces has the real path
                    debug!("endpoint::body::file.template={:?}", template);
                    Some(template.evaluate_with_star().into())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        // file providers
        let mut provider_files = self
            .0
            .providers
            .iter()
            .filter_map(|(_, v)| {
                if let Provider::File(f) = v {
                    Some(f.path.as_str().into())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        provider_files.append(&mut body_files);
        provider_files.into_boxed_slice()
    }

    // returns nothing if the config file has no errors, throws an error containing a string description, if the config file has errors
    #[wasm_bindgen(js_name = checkOk)]
    pub fn check_ok(&self) -> Result<(), JsValue> {
        self.0
            .ok_for_loadtest()
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
}
