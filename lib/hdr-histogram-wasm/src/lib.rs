#![allow(clippy::all)]
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use hdrhistogram::{serialization::Deserializer, Histogram};
use log::LevelFilter;
use std::str::FromStr;
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
pub struct HDRHistogram(Histogram<u64>);

#[wasm_bindgen]
impl HDRHistogram {
    #[wasm_bindgen(constructor)]
    pub fn from_base64(base64: String, log_level: Option<String>) -> Result<HDRHistogram, JsValue> {
        init_logging(log_level);
        let bytes = STANDARD_NO_PAD
            .decode(&base64)
            .map_err(|_| JsValue::from_str("could not parse as a bas64 string"))?;
        let mut deserializer = Deserializer::new();
        let mut histogram = deserializer
            .deserialize(&mut &*bytes)
            .map_err(|_| JsValue::from_str("could not parse bas64 string into an HDRHistogram"))?;
        histogram.auto(true);
        Ok(HDRHistogram(histogram))
    }

    #[wasm_bindgen(js_name = getMean)]
    pub fn mean(&self) -> f64 {
        self.0.mean()
    }

    #[wasm_bindgen(js_name = getStdDeviation)]
    pub fn stddev(&self) -> f64 {
        self.0.stdev()
    }

    #[wasm_bindgen(js_name = getTotalCount)]
    pub fn len(&self) -> u64 {
        self.0.len()
    }

    #[wasm_bindgen(js_name = getValueAtPercentile)]
    pub fn value_at_percentile(&self, percentile: f64) -> u64 {
        self.0.value_at_percentile(percentile)
    }

    #[wasm_bindgen]
    pub fn add(&mut self, other: &HDRHistogram) -> Result<(), JsValue> {
        self.0
            .add(&other.0)
            .map_err(|_| JsValue::from_str("could not combine HDRHistograms"))
    }

    #[wasm_bindgen(js_name = getMinNonZeroValue)]
    pub fn min_nz(&self) -> u64 {
        self.0.min_nz()
    }

    #[wasm_bindgen(js_name = getMaxValue)]
    pub fn max(&self) -> u64 {
        self.0.max()
    }

    #[wasm_bindgen]
    pub fn clone(&self) -> HDRHistogram {
        let mut inner = self.0.clone();
        inner.auto(true);
        HDRHistogram(inner)
    }
}
