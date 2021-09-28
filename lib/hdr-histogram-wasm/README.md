# hdr-histogram-wasm
This project exposes hdrhistogram APIs for use in the pewpew results viewer via WASM. It has superior performance to the native JavaScript version (HdrHistogramJS).

### To build
First ensure you have [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) and [Rust](https://www.rust-lang.org/tools/install) installed. Then run `wasm-pack build --release -t web --scope fs`


### Usage:
```js

export class HDRHistogram {
/**
 * Free's the memory after creating a PewPew HDRHistogram object. MUST BE CALLED TO AVOID LEAKS
 */
  free(): void;

/**
 * Creates a PewPew HDRHistogram object from a stats file base64 string
 * @param {string} base64 encoded string from a stats result file
 * @param {string: optional} log_level What level to log at (default: error). Only set on first call. Subsequent log_level(s) are ignored
 */
  constructor(base64: string, log_level?: string);

/**
 * @returns {number}
 */
  getMean(): number;

/**
 * @returns {number}
 */
  getStdDeviation(): number;

/**
 * @returns {BigInt}
 */
  getTotalCount(): BigInt;

/**
 * @param {number} percentile
 * @returns {BigInt}
 */
  getValueAtPercentile(percentile: number): BigInt;

/**
 * @param {HDRHistogram} other
 */
  add(other: HDRHistogram): void;

/**
 * @returns {BigInt}
 */
  getMinNonZeroValue(): BigInt;

/**
 * @returns {BigInt}
 */
  getMaxValue(): BigInt;

/**
 * Clones the histogram. Clone must be free'd separately with copy.free();
 * @returns {HDRHistogram}
 */
  clone(): HDRHistogram;
}
```
Example:
```js
let hdrHistogram;
try {
  hdrHistogram = new HDRHistogram(statsBase64String, "debug");
  console.log("Max Value: " + config.getMaxValue());
  console.log("Mean Value: " + config.getMean());
} finally {
  if (hdrHistogram) {
    hdrHistogram.free();
  }
}
```
