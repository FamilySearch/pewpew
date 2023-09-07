use config::LoadTest as LoadTestConfig;
use config_gen::{load_test_yaml_from_js, LoadTest};
use serde_json::json;
use std::{collections::BTreeMap, path::PathBuf};
use wasm_bindgen::JsValue;
use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen_test]
fn complex() {
    let json = json!({
        "vars": {
            "port": "${e:PORT}",
            "token": "${x:random(1, 100)}"
        },
        "load_pattern": [{
            "linear": {
                "from": "100%",
                "to": "100%",
                "over": "2m"
            }
        }],
        "providers": {
            "sequence": {"list": [123,456]}
        },
        "endpoints": [
            {
              "url": "localhost:${v:port}/${v:token}${p:sequence}",
              "peak_load": "1.1hps"
            }
        ],
        "loggers": {
            "test": { "to": "stdout", "query": {"select": {"a": ["request"], "timestamp": "epoch(\"ms\")"}} },
            "test2": {"to": {"file": "out.txt"}}
        }
    });
    let json_str = serde_json::to_string(&json).unwrap();
    let lt: LoadTest = serde_json::from_str(&json_str).unwrap();
    let yaml1 = load_test_yaml_from_js(&json_str, None)
        .map_err(JsValue::from)
        .unwrap();

    let env_vars = BTreeMap::from([("PORT".to_string(), "8090".to_string())]);
    let load_test = LoadTestConfig::from_yaml(yaml1.as_str(), PathBuf::default().into(), &env_vars)
        .map_err(|e| JsValue::from_str(&format!("{e:?}")));
    if load_test.is_err() {
        panic!("{:?}", load_test.unwrap_err());
    }
    assert!(load_test.is_ok());
    let load_test = load_test.unwrap();
    let ok_for_loadtest = load_test.ok_for_loadtest();
    if ok_for_loadtest.is_err() {
        panic!("{:?}", ok_for_loadtest.unwrap_err());
    }
    assert!(ok_for_loadtest.is_ok());

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
  sequence: !list
    - 123
    - 456
endpoints:
    - url: localhost:${v:port}/${v:token}${p:sequence}
      peak_load: 1.1hps
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
    let json = json!({
    "vars":{
        "rampTime":"${e:RAMP_TIME}",
        "loadTime":"${e:LOAD_TIME}",
        "peakLoad":"${e:PEAK_LOAD}",
        "sessionId":"${e:SESSIONID}"},
        "config":{
            "client":{"headers":{"User-Agent":"Pewpew Performance Load Test"}},
            "general":{"bucket_size":"1m","log_provider_stats":true}
        },
        "load_pattern":[
            {"linear":{"from":"10%","to":"100%","over":"15m"}},
            {"linear":{"from":"100%","to":"100%","over":"15m"}}
        ],
        "endpoints": [
            {
              "url": "localhost",
              "peak_load": "1.1hps"
            }
        ],
        "loggers":{
            "httpErrors":{
                "query":{
                    "select":{
                        "timestamp":"epoch(\"ms\")",
                        "rtt":"stats.rtt","request":
                        "request[\"start-line\"]",
                        "requestHeaders":"request.headers",
                        "requestBody":"request.body",
                        "response":"response[\"start-line\"]",
                        "status":"response.status",
                        "responseHeaders":"response.headers"
                    },
                    "where":"response.status >= 400"
                },
                "to":"stderr",
                "limit":200
            },
            "testEnd":{
                "query":{
                    "select":{
                        "timestamp":"epoch(\"ms\")",
                        "status":"response.status",
                        "request":"request[\"start-line\"]",
                        "response":"response[\"start-line\"]"
                    },
                    "where":"response.status >= 500"
                },
                "to":"stderr",
                "limit":50,
                "kill":true
            }
        }
    });
    let json_str = serde_json::to_string(&json).unwrap();
    let _lt: LoadTest = serde_json::from_str(&json_str).unwrap();
    let yaml = load_test_yaml_from_js(&json_str, None)
        .map_err(JsValue::from)
        .unwrap();

    let env_vars = BTreeMap::from([
        ("RAMP_TIME".to_string(), "1m".to_string()),
        ("LOAD_TIME".to_string(), "1m".to_string()),
        ("PEAK_LOAD".to_string(), "1hps".to_string()),
        ("SESSIONID".to_string(), "bogus".to_string()),
    ]);
    let load_test = LoadTestConfig::from_yaml(yaml.as_str(), PathBuf::default().into(), &env_vars)
        .map_err(|e| JsValue::from_str(&format!("{e:?}")));

    assert!(load_test.is_ok());
    assert!(load_test.unwrap().ok_for_loadtest().is_ok());
}
