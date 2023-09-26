const { expect } = require("chai");
const { Config } = require("../../config-wasm/pkg/config_wasm");
const { load_test_yaml_from_js } = require("../pkg/config_gen");
const { readFile: _readFile } = require("fs");

const jsonBasic = {
  "vars": {
    "port": "${e:PORT}",
    "token": "${x:random(1, 100)}"
  },
  "load_pattern": [{
     "linear": {
        "from": "10%",
        "to": "100%",
        "over": "1h"
      }
    },{
    "linear": {
      "from": "100%",
      "to": "100%",
      "over": "90m"
    }
  }],
  "providers": {
      "sequence": {"list": []}
  },
  "endpoints": [
      {
        "url": "localhost:${v:port}/${v:token}${p:sequence}",
        "peak_load": "1hpm"
      }
  ],
  "loggers": {
      "test": { "to": "stdout", "query": {"select": {"a": ["request"], "timestamp": "epoch(\"ms\")"}} },
      "test2": {"to": {"file": "out.txt"}}
  }
};
const yamlBasic = `vars:
  port: \${e:PORT}
  token: \${x:random(1, 100)}
load_pattern:
- !linear
  from: 10%
  to: 100%
  over: 1h
- !linear
  from: 100%
  to: 100%
  over: 90m
config:
  client:
    request_timeout: 1m
    headers: {}
    keepalive: 90s
  general:
    auto_buffer_start_size: 5
    bucket_size: 1m
    log_provider_stats: true
    watch_transition_time: null
loggers:
  test:
    query:
      select:
        a:
        - request
        timestamp: epoch("ms")
      for_each: []
      where: null
    limit: null
    to: stdout
    pretty: false
    kill: false
  test2:
    query: null
    limit: null
    to: !file out.txt
    pretty: false
    kill: false
providers:
  sequence: !list
    values: []
    random: false
    repeat: true
    unique: false
endpoints:
- method: GET
  url: localhost:\${v:port}/\${v:token}\${p:sequence}
  tags: {}
  declare: {}
  headers: {}
  body: null
  load_pattern: null
  peak_load: 1hpm
  provides: {}
  on_demand: false
  logs: {}
  max_parallel_requests: null
  no_auto_returns: false
  request_timeout: null
`

const jsonComplex = {
  "vars": {
    "rampTime":"${e:RAMP_TIME}",
    "loadTime":"${e:LOAD_TIME}",
    "peakLoad":"${e:PEAK_LOAD}",
    "sessionId":"${e:SESSIONID}",
    "b": "foo",
    "e2": ["foo", "foo", "foo"],
    "port": "${e:PORT}",
  },
  "config":{
    "client":{
      "headers":{
        "User-Agent":"Pewpew Performance Load Test",
        "SESSION_ID":"${v:sessionId}"
      }
    },
    "general":{"bucket_size":"1m","log_provider_stats":true}
  },
  "load_pattern":[
    {"linear":{"from":"10%","to":"100%","over":"15m"}},
    {"linear":{"from":"100%","to":"100%","over":"15m"}}
  ],
  "loggers":{
    "httpErrors":{
      "query":{
        "select":{
          "timestamp":"epoch(\"ms\")",
          "rtt":"stats.rtt",
          "request":"request[\"start-line\"]",
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
  },
  providers:{
  a: {range: {}},
  c: {
    list:[
      - 123
      - 456
    ]
  },
  d: {
    response: {}
  },
  f: {
    file: {
      path: "integration.data",
      repeat: true
    }
  }
},
endpoints:[
  {
    method: "POST",
    declare:{
      e: {
        c: {
          collects:[{
            take: 3,
            from: '${v:b}',
            as: "_b",
          }],
          then: "${p:_b}"
        }
      }
    },
    url: "http://localhost:${v:port}/",
    body: { str: '{"a": ${p:a}, "b": "${v:b}", "c": ${p:c}, "e": ${p:e}, "e2": ${v:e2}, "f": "${p:f}"}'},
    peak_load: "1.1hps",
    headers: {
      "Content-Type": "application/json"
    },
    logs: {
      l:{
        select: {
          each: [
            'response.body.b == "foo"',
            'val_eq(response.body.e, response.body.e2)',
            'request.headers.test == "123"',
            'parseInt(request.headers.test) + 1 == 124',
            'parseInt(request.headers.float) == 1',
            'parseFloat(request.headers.float) == 1.23',
            'parseInt(response.body.b) == null',
            'response.body.a == 0',
            'response.body.c == 123',
            'response.body.f == "line1"',
            'response.body.a == 1',
            'response.body.c == 456',
            'response.body.f == "line2"',
          ],
          all: `
            (response.body.b == "foo"
              && val_eq(response.body.e, response.body.e2)
              && request.headers.test == "123"
              && parseInt(request.headers.test) + 1 == 124
              && parseInt(request.headers.float) == 1
              && parseFloat(request.headers.float) == 1.23
              && parseInt(response.body.b) == null
            )
            &&
            (
              (response.body.a == 0
                && response.body.c == 123
                && response.body.f == "line1")
              ||
              (response.body.a == 1
                && response.body.c == 456
                && response.body.f == "line2")
            )`
          }
        }
      }
    }
  ]
};

describe("config-gen", () => {
  let config;
  const varMap = new Map();

  afterEach(() => {
    varMap.clear();
    if (config) {
      config.free();
    }
    config = undefined;
  });

  // The ERROR tests must be first. Once it's initialized, the log setup doesn't fire
  it("should throw error on invalid log_level", (done) => {
    try {
      const yaml = load_test_yaml_from_js(JSON.stringify(jsonBasic), "bogus");
      done(new Error("bogus should have failed"));
    } catch (error) {
      expect(`${error}`).to.include("attempted to convert a string that doesn't match an existing log level");
      done();
    }
  });

  // Once we've set the logs once, we can never change it
  it("should change log_level to warn", (done) => {
    try {
      const yaml = load_test_yaml_from_js(JSON.stringify(jsonBasic), "warn");
      expect(yaml).to.not.equal(undefined);
      expect(yaml).to.equal(yamlBasic);
      varMap.set("PORT", "8081");
      config = new Config(Buffer.from(yaml, "utf8"), varMap);
      expect(config).to.not.equal(undefined);
      config.checkOk();
      done();
    } catch (error) {
      console.error("test error", error);
      done(error);
    }
  });

  // Once we've set the logs once, we can never change it
  it("should not require a log level", (done) => {
    try {
      const yaml = load_test_yaml_from_js(JSON.stringify(jsonBasic));
      expect(yaml).to.not.equal(undefined);
      expect(yaml).to.equal(yamlBasic);
      varMap.set("PORT", "8081");
      config = new Config(Buffer.from(yaml, "utf8"), varMap);
      expect(config).to.not.equal(undefined);
      config.checkOk();
      done();
    } catch (error) {
      console.error("test error", error);
      done(error);
    }
  });

  // Once we've set the logs once, we can never change it
  it("should load a complex test", (done) => {
    try {
      const yaml = load_test_yaml_from_js(JSON.stringify(jsonComplex));
      expect(yaml).to.not.equal(undefined);
      varMap.set("PORT", "8080");
      varMap.set("RAMP_TIME", "1m");
      varMap.set("LOAD_TIME", "1m");
      varMap.set("PEAK_LOAD", "1hps");
      varMap.set("SESSIONID", "bogus");
      config = new Config(Buffer.from(yaml, "utf8"), varMap);
      expect(config).to.not.equal(undefined);
      config.checkOk();
      done();
    } catch (error) {
      console.error("test error", error);
      done(error);
    }
  });
});
