use config_gen::*;
use serde_json::json;
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn complex() {
    let json = json!({
        "vars": {
            "port": "${e:PORT}",
            "token": "${x:random(1, 100)}"
        },
        "load_pattern": [
            { "linear": {
                "from": "100%",
                "to": "100%",
                "over": "2m"
        }}],
        "providers": {
            "sequence": {"list": []}
        },
        "endpoints": [
            {"url": "localhost:${v:port}/${v:token}${p:sequence}"}
        ],
        "loggers": {
            "test": { "to": "stdout", "query": {"select": {"a": ["request"], "timestamp": "epoch(\"ms\")"}} },
            "test2": {"to": {"file": "out.txt"}}
        }
    });
    let json_str = serde_json::to_string(&json).unwrap();
    let lt: LoadTest = serde_json::from_str(&json_str).unwrap();
    let yaml1 = load_test_yaml_from_js(&json_str)
        .map_err(JsValue::from)
        .unwrap();
    let lt2: LoadTest = serde_yaml::from_str(&yaml1).unwrap();
    let yaml2 = serde_yaml::to_string(&lt).unwrap();
    assert_eq!(yaml1, yaml2);
    let yaml3 = r#"
vars:
  port: ${e:PORT}
  token: ${x:random(1, 100)}
load_pattern:
  - !linear
    from: 100%
    to: 100%
    over: 2m
providers:
  sequence: !list []
endpoints:
    - url: localhost:${v:port}/${v:token}${p:sequence}
loggers:
  test:
    to: !stdout
    query:
      select:
        a:
          - request
        timestamp: epoch("ms")
  test2:
    to: !file out.txt
"#;
    let lt3: LoadTest = serde_yaml::from_str(&yaml3.to_owned()).unwrap();
    assert_eq!(lt, lt3);
    assert_eq!(lt, lt2);
}

#[wasm_bindgen_test]
fn other_test() {
    let json_str = "{\"vars\":{\"rampTime\":\"${e:RAMP_TIME}\",\"loadTime\":\"${e:LOAD_TIME}\",\"peakLoad\":\"${e:PEAK_LOAD}\",\"sessionId\":\"${e:SESSIONID}\"},\"config\":{\"client\":{\"headers\":{\"User-Agent\":\"FS-QA-SystemTest\"}},\"general\":{\"bucket_size\":\"1m\",\"log_provider_stats\":true}},\"load_pattern\":[{\"linear\":{\"from\":\"10%\",\"to\":\"100%\",\"over\":\"15m\"}},{\"linear\":{\"from\":\"100%\",\"to\":\"100%\",\"over\":\"15m\"}}],\"loggers\":{\"httpErrors\":{\"query\":{\"select\":{\"timestamp\":\"epoch(\\\"ms\\\")\",\"rtt\":\"stats.rtt\",\"request\":\"request[\\\"start-line\\\"]\",\"requestHeaders\":\"request.headers\",\"requestBody\":\"request.body\",\"response\":\"response[\\\"start-line\\\"]\",\"status\":\"response.status\",\"responseHeaders\":\"response.headers\"},\"where\":\"response.status >= 400\"},\"to\":\"stderr\",\"limit\":200},\"testEnd\":{\"query\":{\"select\":{\"timestamp\":\"epoch(\\\"ms\\\")\",\"status\":\"response.status\",\"request\":\"request[\\\"start-line\\\"]\",\"response\":\"response[\\\"start-line\\\"]\"},\"where\":\"response.status >= 500\"},\"to\":\"stderr\",\"limit\":50,\"kill\":true}}}";
    let _lt: LoadTest = serde_json::from_str(json_str).unwrap();
    let _yaml = load_test_yaml_from_js(json_str)
        .map_err(JsValue::from)
        .unwrap();
}
