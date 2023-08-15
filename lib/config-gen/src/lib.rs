use config::templating::False;
use log::LevelFilter;
use std::str::FromStr;
use wasm_bindgen::{prelude::wasm_bindgen, throw_str, JsError, UnwrapThrowExt};

pub type LoadTest = config::LoadTest<False, False>;

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
pub fn load_test_yaml_from_js(data: &str, log_level: Option<String>) -> Result<String, JsError> {
    init_logging(log_level);
    // had some issues getting direct conversion from JsValue, so stringified JSON is used
    console_error_panic_hook::set_once();
    log::debug!("load_test_yaml_from_js data: {}", data);
    let load_test: LoadTest = serde_json::from_str(data)?;
    log::debug!("load_test_yaml_from_js load_test: {:?}", load_test);
    let yaml = serde_yaml::to_string(&load_test)?;
    log::debug!("load_test_yaml_from_js yaml: {}", yaml);
    Ok(yaml)
}
