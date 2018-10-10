use futures::{
    future::join_all,
    Sink,
    Stream,
};
use handlebars::Handlebars;
use hyper::{
    Body as HyperBody,
    Error as HyperError,
    Method,
    Request
};
use serde_json::{
    self as json,
    Value as JsonValue
};
use tokio::{
    prelude::*,
    timer::{ Timeout, Error as TimerError }
};

use crate::channel;
use crate::config::{EndpointProvides, StatusChecker};
use crate::for_each_parallel::ForEachParallel;
use crate::load_test::LoadTest;
use crate::providers;
use crate::stats::ResponseStat;
use crate::template::{
    json_value_to_string,
    stringify_helper,
    textify,
    textify_json,
    TextifyReturnFn};
use crate::zip_all::zip_all;

use std::{
    cmp,
    collections::{BTreeMap, BTreeSet},
    io::Error as IOError,
    ops::{Deref, DerefMut},
    str,
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

struct EndpointProvidesFinal {
    require_body: bool,
    require_headers: bool,
    skip_if_full: bool,
    status: Box<StatusChecker>,
    value: Box<TextifyReturnFn>,
}

pub struct Builder<T> where T: Stream<Item=Instant, Error=TimerError> + Send + 'static {
    body: Option<String>,
    headers: Vec<(String, String)>,
    method: Method,
    start_stream: Option<T>,
    provides: Vec<(String, EndpointProvides)>,
    stats_id: Option<BTreeMap<String, String>>,
    uri: String,
}

enum ProviderResponse {
    Channel(channel::Receiver<Vec<u8>>),
    Value(JsonValue),
}

enum StreamsReturn {
    Body(ProviderResponse),
    Instant(Instant),
    TemplateValue((String, JsonValue)),
}

type StreamsElement = Box<dyn Stream<Item=StreamsReturn, Error=()> + Send + 'static>;

#[derive(Debug)]
pub struct TemplateValues(JsonValue);

impl TemplateValues {
    pub fn new () -> Self {
        TemplateValues(JsonValue::Object(json::Map::new()))
    }

    pub fn as_json (&self) -> &JsonValue {
        &self.0
    }
}

impl Deref for TemplateValues {
    type Target = json::Map<String, JsonValue>;

    fn deref (&self) -> &Self::Target {
        match &self.0 {
            JsonValue::Object(o) => o,
            _ => panic!("cannot deref json value as object")
        }
    }
}

impl DerefMut for TemplateValues {
    fn deref_mut (&mut self) -> &mut json::Map<String, JsonValue> {
        match &mut self.0 {
            JsonValue::Object(o) => o,
            _ => panic!("cannot deref json value as object")
        }
    }
}

impl From<JsonValue> for TemplateValues {
    fn from (map: JsonValue) -> Self {
        TemplateValues(map)
    }
}

impl<T> Builder<T> where T: Stream<Item=Instant, Error=TimerError> + Send + 'static{
    pub fn new (uri: String, start_stream: Option<T>) -> Self {
        Builder {
            body: None,
            headers: Vec::new(),
            method: Method::GET,
            start_stream,
            provides: Vec::new(),
            stats_id: None,
            uri,
        }
    }

    pub fn provides (mut self, providers: Vec<(String, EndpointProvides)>) -> Self {
        self.provides.extend(providers);
        self
    }

    pub fn method (mut self, method: Method) -> Self {
        self.method = method;
        self
    }

    pub fn headers (mut self, mut headers: Vec<(String, String)>) -> Self {
        self.headers.append(&mut headers);
        self
    }

    pub fn body (mut self, body: Option<String>) -> Self {
        self.body = body;
        self
    }

    pub fn stats_id (mut self, stats_id: Option<BTreeMap<String, String>>) -> Self {
        self.stats_id = stats_id;
        self
    }

    pub fn build (mut self, ctx: &mut LoadTest, endpoint_id: usize)
        -> (impl Future<Item=(), Error=()> + Send) {
        let mut streams: Vec<StreamsElement> = Vec::new();
        if let Some(start_stream) = self.start_stream {
            streams.push(
                Box::new(start_stream.map(StreamsReturn::Instant)
                    .map_err(|e| panic!("error from interval stream {}\n", e)))
            );
        }
        let mut required_providers = BTreeSet::new();
        let mut handlebars = Handlebars::new();
        handlebars.register_helper("stringify", Box::new(stringify_helper));
        handlebars.set_strict_mode(true);
        let handlebars = Arc::new(handlebars);
        let (uri, provider_names) = textify(self.uri, handlebars.clone(), true);
        required_providers.extend(provider_names);
        let headers: Vec<_> = self.headers.into_iter()
            .map(|(k, v)| {
                let (key, provider_names) = textify(k, handlebars.clone(), true);
                required_providers.extend(provider_names);
                let (value, provider_names) = textify(v, handlebars.clone(), true);
                required_providers.extend(provider_names);
                (key, value)
            }).collect();
        let mut max_buffer = 0;
        let mut response_provides = Vec::new();
        for (k, v) in self.provides {
            let provider = ctx.providers.get(&k).unwrap_or_else(|| panic!("undeclared provider `{}`", k));
            let tx = match provider {
                providers::Kind::Value(p) => p.tx.clone(),
                providers::Kind::Body(_) => panic!("response provider cannot feed a body provider")
            };
            if !v.skip_if_full {
                max_buffer = cmp::max(max_buffer, tx.limit());
            }
            // transform the response providers into `Fn`s that will be used later
            let (value, provider_names) = textify_json(v.value, handlebars.clone());
            let mut require_body = false;
            let mut require_headers = false;
            for s in provider_names {
                if s == "body" {
                    require_body = true;
                } else if s == "headers" {
                    require_headers = true;
                } else {
                    required_providers.insert(s);
                }
            }
            let r = EndpointProvidesFinal {
                require_body,
                require_headers,
                skip_if_full: v.skip_if_full,
                status: v.status.unwrap_or_else(|| Box::new(|_| true)),
                value,
            };
            response_provides.push((r, tx));
        }
        let response_provides = Arc::new(response_provides);
        let mut body = if let Some(body) = self.body {
            let (body, provider_names) = textify(body, handlebars.clone(), true);
            required_providers.extend(provider_names);
            Some(body)
        } else {
            None
        };
        // go through the list of required providers and make sure we have them all
        for name in required_providers {
            let kind = ctx.providers.get(&name)
                .unwrap_or_else(|| panic!("unknown provider `{}`", &name));
            let provider_stream = match kind {
                providers::Kind::Value(s) => {
                    Box::new(Stream::map(s.rx.clone(), move |v| StreamsReturn::TemplateValue((name.clone(), v)))
                        .map_err(|_| panic!("error from provider"))
                    )
                },
                providers::Kind::Body(_) =>
                    panic!("invalid provider inside template `{}`. Only string providers can be referenced within templates", &name)
            };
            streams.push(provider_stream);
        }
        let open_requests = ctx.open_requests.clone();
        let stats_tx = ctx.stats_tx.clone();
        let client = ctx.client.clone();
        let method = self.method.clone();
        let stats_id = self.stats_id.take();

        let test_timeout = ctx.test_timeout.clone();
        let streams = zip_all(streams).map_err(|_| panic!("error from zip_all"))
            .select(ctx.test_timeout.clone().into_stream().map(|_| unreachable!("timeouts only error")));
        ForEachParallel::new(max_buffer, streams, move |values| {
            let mut template_values = TemplateValues::new();
            let mut body_stream = None;
            for tv in values {
                match tv {
                    StreamsReturn::TemplateValue((name, value)) => {
                        template_values.insert(name, value);
                    },
                    StreamsReturn::Body(channel) => {
                        body_stream = Some(channel);
                    },
                    StreamsReturn::Instant(_) => {}
                };
            }
            let mut request = Request::builder();
            let url = json_value_to_string(&uri(&template_values));
            request.uri(&url);
            request.method(method.clone());
            for (k, v) in &headers {
                let key = json_value_to_string(&k(&template_values));
                let value = json_value_to_string(&v(&template_values));
                request.header(key.as_str(), value.as_str());
            }
            let body = if let Some(response) = body_stream {
                match response {
                    ProviderResponse::Channel(channel) => HyperBody::wrap_stream(
                        channel.map_err(|_| -> IOError { unreachable!() })
                    ),
                    ProviderResponse::Value(v) => json_value_to_string(&v).into(),
                }
            } else if let Some(render) = body.as_mut() {
                json_value_to_string(&render(&template_values)).into()
            } else {
                HyperBody::empty()
            };
            let request = request.body(body).unwrap();
            let response_future = client.request(request);
            let now = Instant::now();
            let open_requests = open_requests.clone();
            let _open_requests2 = open_requests.clone();
            let stats_id = stats_id.clone();
            let stats_tx = stats_tx.clone();
            let method = method.clone();
            let request_providers = response_provides.clone();
            let test_timeout = test_timeout.clone();
            // println!("requesting {}", url);
            Timeout::new(response_future, Duration::from_secs(60))
                .map_err(move |err| {
                    let time_between = duration_to_nanos(&now.elapsed()) / 1_000_000;
                    if let Some(err) = err.into_inner() {
                        // connection errors
                        // let unfinished_requests = open_requests2.fetch_sub(1, Ordering::Relaxed) - 1;
                        // // print!("{}", format!("{} unfinished requests\n", unfinished_requests));
                        // let io_error_maybe = err.cause2();
                        // if let Some(io_error_maybe) = io_error_maybe {
                        //     let is_connection_err = match io_error_maybe.downcast_ref::<IOError>() {
                        //         Some(ref err) if err.kind() == IOErrorKind::AddrInUse
                        //             || cfg!(windows) && err.raw_os_error() == Some(10055) => true, // see https://docs.microsoft.com/en-us/windows/desktop/winsock/windows-sockets-error-codes-2
                        //         _ => false
                        //     };
                        //     // if is_connection_err && exhausted_ports.load(Ordering::Relaxed) < unfinished_requests {
                        //     //     print!("{}", format!("Ran out of ephemeral ports. Stopping new connections until unfinished requests go under {}\n", unfinished_requests / 2));
                        //     //     exhausted_ports.store(unfinished_requests / 2, Ordering::Relaxed);
                        //     // }
                        // }
                        eprint!("{}", format!("err: {:?}; took {}ms\n", err, time_between));
                    } else {
                        eprint!("{}", format!("request timed out; took {}ms\n", time_between));
                    }
                })
                .and_then(move |response| {
                    let status = response.status().as_u16();
                    let mut provider_needs_headers = false;
                    let mut provider_needs_body = false;
                    let mut provider_indexes = Vec::new();
                    for (i, (v, _)) in request_providers.iter().enumerate() {
                        if (v.status)(status) {
                            if !provider_needs_headers {
                                provider_needs_headers = v.require_headers;
                            }
                            if !provider_needs_body {
                                provider_needs_body = v.require_body;
                            }
                            provider_indexes.push(i);
                        }
                    }
                    if provider_needs_headers {
                        let mut headers_json = json::Map::new();
                        for (k, v) in response.headers() {
                            headers_json.insert(
                                k.as_str().to_string(),
                                JsonValue::String(
                                    v.to_str().expect("could not parse HTTP response header as utf8 string")
                                        .to_string()
                                )
                            );
                        }
                        template_values.insert("headers".to_string(), JsonValue::Object(headers_json));
                    }
                    let body_stream: Box<dyn Future<Item=Option<JsonValue>, Error=HyperError> + Send> =
                        if provider_needs_body {
                            Box::new(
                                response.into_body()
                                    .concat2()
                                    .and_then(|body| {
                                        let s = str::from_utf8(&body).expect("error parsing body as utf8");
                                        let value = if let Ok(value) = json::from_str(s) {
                                            value
                                        } else {
                                            JsonValue::String(s.to_string())
                                        };
                                        Ok(Some(value))
                                    })
                            )
                        } else {
                            // if we don't need the body, skip parsing it
                            Box::new(
                                response.into_body()
                                    .for_each(|_| Ok(()))
                                    .and_then(|_| Ok(None))
                            )
                        };
                    body_stream
                        .then(move |result| {
                            // open_requests.fetch_sub(1, Ordering::Relaxed);
                            let rtt = (duration_to_nanos(&now.elapsed()) / 1_000_000) as u64;
                            let mut futures: Vec<Box<dyn Future<Item=(), Error=()> + Send>> = Vec::new();
                            match result {
                                Ok(body) => {
                                    if let Some(body) = body {
                                        template_values.insert("body".to_string(), body);
                                    }
                                    for n in &provider_indexes {
                                        let (v, tx) = &request_providers[*n];
                                        let value = (v.value)(&template_values);
                                        if v.skip_if_full {
                                            let _ = tx.try_send(value);
                                        } else {
                                            futures.push(Box::new(
                                                Sink::send(tx.clone(), value)
                                                    .map(|_| ())
                                                    .map_err(|_| panic!("provider channel should not yet be closed"))
                                                    .select(test_timeout.clone().then(|_| Ok(())))
                                                    .then(|_| Ok(()))
                                            ));
                                        }
                                    }
                                    futures.push(Box::new(
                                        stats_tx.send(
                                            ResponseStat {
                                                endpoint_id,
                                                key: stats_id,
                                                rtt,
                                                method,
                                                status,
                                                time: SystemTime::now(),
                                                url,
                                            }.into()
                                        )
                                        .and_then(|_| Ok(()))
                                        .map_err(|e| panic!("unexpected error trying to send stats, {}", e))
                                    ));
                                },
                                Err(ref err) => eprint!("{}", format!("err getting body: {:?}\n took {}ms\n", err, rtt))
                            }
                            join_all(futures)
                                .and_then(|_| Ok(()))
                        })
                // all error cases should have been handled before catching them here
                }).then(|_| Ok(()))
        // should only get to this `or_else` due to test timeout
        }).or_else(|_| Ok(()))
    }
}

fn duration_to_nanos (d: &Duration) -> u128 {
    u128::from(d.as_secs()) * 1_000_000_000 + u128::from(d.subsec_nanos())
}