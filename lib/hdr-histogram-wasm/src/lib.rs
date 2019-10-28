use hdrhistogram::{serialization::Deserializer, Histogram};
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};

#[wasm_bindgen]
pub struct HDRHistogram(Histogram<u64>);

#[wasm_bindgen]
impl HDRHistogram {
    #[wasm_bindgen(constructor)]
    pub fn from_base64(base64: String) -> Result<HDRHistogram, JsValue> {
        let bytes = base64::decode(&base64)
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
