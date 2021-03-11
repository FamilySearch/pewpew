# config-wasm
This project exposes the config parser for use in the pewpew test runner via WASM. It allows us to validate the yaml before spinning up an instance to run a test.

### To build
First ensure you have [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) and [Rust](https://www.rust-lang.org/tools/install) installed. Then run `build-node.sh`