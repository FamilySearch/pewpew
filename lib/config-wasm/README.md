# config-wasm
This project exposes the config parser for use in the pewpew test runner via WASM. It allows us to validate the yaml before spinning up an instance to run a test.

### To build
First ensure you have [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) and [Rust](https://www.rust-lang.org/tools/install) installed. Then run `wasm-pack build --release -t nodejs --scope fs`


### Usage:
```js
export class Config {
/**
 * Free's the memory after creating a PewPew Config object. MUST BE CALLED TO AVOID LEAKS
 */
  free(): void;

/**
 * Creates a PewPew Config object from a config file contents and any environment variables
 * @param {Uint8Array} bytes The contents of the file
 * @param {Map<any, any>} env_vars Any environment variables (or an empty Map)
 * @param {string: optional} log_level What level to log at (default: error). Only set on first call. Subsequent log_level(s) are ignored
 */
  constructor(bytes: Uint8Array, env_vars: Map<any, any>, log_level?: string);

/**
 * Returns the duration of the test
 * @returns {BigInt}
 */
  getDuration(): BigInt;

/**
 * Returns the formatted paths of any logger files
 * @returns {any[]}
 */
  getLoggerFiles(): any[];

/**
 * Returns the bucket size that data will be logged
 * @returns {BigInt}
 */
  getBucketSize(): BigInt;

/**
 * Returns the formatted paths of any input files
 * @returns {any[]}
 */
  getInputFiles(): any[];

/**
 * Checks whether the configuration file is valid and if all environment variables required are provided
 * @throws {error} Throws on invalid yaml, or missing environment variables
 */
  checkOk(): void;
}
```
Example:
```js
let config;
try {
  config = new HDRHistogram(testFile, new Map(["variableName","variableValue"]), "debug");
  config.checkOk();
  console.log("Test Duration: " + config.getDuration());
} finally {
  if (config) {
    config.free();
  }
}
```
