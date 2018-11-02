use futures::{
    future::join_all,
    Sink,
    stream,
    Stream,
};
use handlebars::Handlebars;
use hyper::{
    Body as HyperBody,
    Method,
    Response,
    Request,
};
use rand::distributions::{Distribution, Uniform};
use serde_json::{
    self as json,
    Value as JsonValue
};
use tokio::{
    prelude::*,
    timer::{ Timeout, Error as TimerError }
};

use crate::channel;
use crate::config::{
    EndpointProvidesSendOptions,
    REQUEST_STARTLINE,
    REQUEST_HEADERS,
    REQUEST_BODY,
    RESPONSE_STARTLINE,
    RESPONSE_HEADERS,
    RESPONSE_BODY,
    Select,
};
use crate::for_each_parallel::ForEachParallel;
use crate::load_test::LoadTest;
use crate::providers;
use crate::stats::ResponseStat;
use crate::template::{
    epoch_helper,
    json_value_to_string,
    join_helper,
    stringify_helper,
    textify,
};
use crate::zip_all::zip_all;

use std::{
    cmp,
    collections::{BTreeMap, BTreeSet},
    ops::{Deref, DerefMut},
    str,
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

enum Either<A, B> {
    A(A),
    B(B),
}

impl<A, B> Stream for Either<A, B>
    where A: Stream,
          B: Stream<Item = A::Item, Error = A::Error>
{
    type Item = A::Item;
    type Error = A::Error;
    fn poll(&mut self) -> Poll<Option<A::Item>, A::Error> {
        match *self {
            Either::A(ref mut a) => a.poll(),
            Either::B(ref mut b) => b.poll(),
        }
    }
}

impl<A, B> Future for Either<A, B>
    where A: Future,
          B: Future<Item = A::Item, Error = A::Error>
{
    type Item = A::Item;
    type Error = A::Error;

    fn poll(&mut self) -> Poll<A::Item, A::Error> {
        match *self {
            Either::A(ref mut a) => a.poll(),
            Either::B(ref mut b) => b.poll(),
        }
    }
}

enum Either3<A, B, C> {
    A(A),
    B(B),
    C(C)
}

impl<A, B, C> Stream for Either3<A, B, C>
    where A: Stream,
          B: Stream<Item = A::Item, Error = A::Error>,
          C: Stream<Item = A::Item, Error = A::Error>,
{
    type Item = A::Item;
    type Error = A::Error;
    fn poll(&mut self) -> Poll<Option<A::Item>, A::Error> {
        match *self {
            Either3::A(ref mut e) => e.poll(),
            Either3::B(ref mut e) => e.poll(),
            Either3::C(ref mut e) => e.poll(),
        }
    }
}

pub enum DeclareProvider {
    Alias(String),
    Collect(usize, Option<usize>, String),
}

impl DeclareProvider {
    pub fn resolve(
                &self,
                providers: &BTreeMap<String,
                providers::Kind>,
                name: &str,
                outgoing: &mut Vec<(Select, channel::Sender<JsonValue>)>
        ) -> impl Stream<Item=JsonValue, Error=()>
    {
        match self {
            DeclareProvider::Alias(s) => {
                let provider = providers.get(s).unwrap_or_else(|| panic!("unknown provider {}", s));
                match provider {
                    providers::Kind::Value(provider) => {
                        if let Some(ar) = provider.auto_return {
                            let j = json::json!({
                                "send": ar.to_string(),
                                "select": name,
                            });
                            let provide: Select = json::from_value(j).unwrap();
                            outgoing.push((provide, provider.tx.clone()));
                        }
                        Either::A(provider.rx.clone())
                    },
                    _ => panic!("Invalid provider referened in declare section, `{}`", s)
                }
            },
            DeclareProvider::Collect(min, max, s) => {
                let provider = providers.get(s).unwrap_or_else(|| panic!("unknown provider {}", s));
                match provider {
                    providers::Kind::Value(provider) => {
                        if let Some(ar) = provider.auto_return {
                            let j = json::json!({
                                "send": ar.to_string(),
                                "select": name,
                            });
                            let provide: Select = json::from_value(j).unwrap();
                            outgoing.push((provide, provider.tx.clone()));
                        }
                        let min = *min;
                        let random = max.map(move |max| Uniform::new_inclusive(min, max));
                        let get_n = move || {
                            if let Some(random) = random {
                                random.sample(&mut rand::thread_rng())
                            } else {
                                min
                            }
                        };
                        let mut rx = provider.rx.clone();
                        let mut holder = Vec::with_capacity(get_n());
                        // TODO, change this to use a random number to specify the size of the vec and
                        // use the Vec::with_capacity constructor
                        let b = stream::poll_fn(move || {
                            let r = match rx.poll() {
                                Ok(Async::Ready(Some(v))) => {
                                    holder.push(v);
                                    if holder.len() == holder.capacity() {
                                        let inner = JsonValue::Array(std::mem::replace(&mut holder, Vec::with_capacity(get_n())));
                                        Async::Ready(Some(inner))
                                    } else {
                                        Async::NotReady
                                    }
                                },
                                Ok(Async::NotReady) => Async::NotReady,
                                Ok(Async::Ready(None)) => Async::Ready(None),
                                Err(_) => return Err(())
                            };
                            Ok(r)
                        });
                        Either::B(b)
                    },
                    _ => panic!("Invalid provider referened in declare section, `{}`", s)
                }
            }
        }
    }
}

pub struct Builder<T> where T: Stream<Item=Instant, Error=TimerError> + Send + 'static {
    body: Option<String>,
    declare: BTreeMap<String, DeclareProvider>,
    headers: Vec<(String, String)>,
    logs: Vec<(String, Select)>,
    method: Method,
    start_stream: Option<T>,
    provides: Vec<(String, Select)>,
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
            declare: BTreeMap::new(),
            headers: Vec::new(),
            logs: Vec::new(),
            method: Method::GET,
            start_stream,
            provides: Vec::new(),
            stats_id: None,
            uri,
        }
    }

    pub fn declare (mut self, providers: BTreeMap<String, DeclareProvider>) -> Self {
        self.declare.extend(providers);
        self
    }

    pub fn provides (mut self, providers: Vec<(String, Select)>) -> Self {
        self.provides.extend(providers);
        self
    }

    pub fn logs (mut self, logs: Vec<(String, Select)>) -> Self {
        self.logs.extend(logs);
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
        let mut streams = Vec::new();
        if let Some(start_stream) = self.start_stream {
            streams.push(
                Either3::A(start_stream.map(StreamsReturn::Instant)
                    .map_err(|e| panic!("error from interval stream {}\n", e)))
            );
        }
        let mut required_providers: BTreeSet<String> = BTreeSet::new();
        let mut handlebars = Handlebars::new();
        handlebars.register_helper("epoch", Box::new(epoch_helper));
        handlebars.register_helper("join", Box::new(join_helper));
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
        let mut precheck_rr_providers = 0;
        let mut rr_providers = 0;
        let mut outgoing = Vec::new();
        for (k, v) in self.provides {
            let provider = ctx.providers.get(&k).unwrap_or_else(|| panic!("undeclared provider `{}`", k));
            let tx = match provider {
                providers::Kind::Body(_) => panic!("response provider cannot feed a body provider"),
                providers::Kind::Value(p) => p.tx.clone(),
            };
            if let EndpointProvidesSendOptions::Block = v.get_send_behavior() {
                max_buffer = cmp::max(max_buffer, tx.limit());
            }
            rr_providers |= v.get_rr_providers();
            precheck_rr_providers |= v.get_where_rr_providers();
            required_providers.extend(v.get_providers().clone());
            outgoing.push((v, tx));
        }
        for (k, v) in self.logs {
            let (tx, select) = ctx.loggers.get(&k).unwrap_or_else(|| panic!("undeclared logger `{}`", k));
            if select.is_some() {
                panic!("endpoint cannot explicitly log to global logger `{}`", k);
            }
            rr_providers |= v.get_rr_providers();
            precheck_rr_providers |= v.get_where_rr_providers();
            required_providers.extend(v.get_providers().clone());
            outgoing.push((v, tx.clone()));
        }
        outgoing.extend(
            ctx.loggers.values()
                .filter_map(|(tx, select)| {
                    if let Some(select) = select {
                        required_providers.extend(select.get_providers().clone());
                        rr_providers |= select.get_rr_providers();
                        precheck_rr_providers |= select.get_where_rr_providers();
                        Some((select.clone(), tx.clone()))
                    } else {
                        None
                    }
                })
        );
        let mut body = if let Some(body) = self.body {
            let (body, provider_names) = textify(body, handlebars.clone(), true);
            required_providers.extend(provider_names);
            Some(body)
        } else {
            None
        };
        for (name, d) in &self.declare {
            required_providers.remove(name);
            let provider_stream = d.resolve(&ctx.providers, name, &mut outgoing);
            let name = name.clone();
            let provider_stream = Either3::B(provider_stream.map(move |v| StreamsReturn::TemplateValue((name.clone(), v))));
            streams.push(provider_stream);
        }
        // go through the list of required providers and make sure we have them all
        for name in required_providers {
            let kind = ctx.providers.get(&name)
                .unwrap_or_else(|| panic!("unknown provider `{}`", &name));
            let receiver = match kind {
                providers::Kind::Body(_) =>
                    panic!("invalid provider inside template `{}`. Only value providers can be referenced within templates", &name),
                providers::Kind::Value(s) => {
                    if let Some(ar) = s.auto_return {
                        let j = json::json!({
                            "send": ar.to_string(),
                            "select": name,
                        });
                        let provide: Select = json::from_value(j).unwrap();
                        outgoing.push((provide, s.tx.clone()));
                    }
                    s.rx.clone()
                },
            };
            let provider_stream = Either3::C(Stream::map(receiver, move |v| StreamsReturn::TemplateValue((name.clone(), v)))
                .map_err(|_| panic!("error from provider"))
            );
            streams.push(provider_stream);
        }
        let outgoing = Arc::new(outgoing);
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
                    StreamsReturn::Instant(_) => ()
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
            let mut body_value = None;
            let body = if let Some(response) = body_stream {
                match response {
                    ProviderResponse::Channel(_) => unimplemented!(),
                    ProviderResponse::Value(v) => {
                        let ret = json_value_to_string(&v).into();
                        if rr_providers & REQUEST_BODY != 0 {
                            body_value = Some(v);
                        }
                        ret
                    },
                }
            } else if let Some(render) = body.as_mut() {
                let v = render(&template_values);
                let body = json_value_to_string(&v).into();
                if rr_providers & REQUEST_BODY != 0 {
                    body_value = Some(v);
                }
                body
            } else {
                HyperBody::empty()
            };
            let request = request.body(body).unwrap();
            let mut request_provider = json::json!({});
            if rr_providers & REQUEST_STARTLINE != 0 {
                let uri_path_and_query = request.uri().path_and_query()
                    .map(|pq| pq.as_str())
                    .unwrap_or("/");
                let version = request.version();
                request_provider.as_object_mut().unwrap()
                    .insert("start-line".into(), format!("{} {} {:?}", method, uri_path_and_query, version).into());
            }
            if rr_providers & REQUEST_HEADERS != 0 {
                let mut headers_json = json::Map::new();
                for (k, v) in request.headers() {
                    headers_json.insert(
                        k.as_str().to_string(),
                        JsonValue::String(
                            v.to_str().expect("could not parse HTTP request header as utf8 string")
                                .to_string()
                        )
                    );
                }
                request_provider.as_object_mut().unwrap()
                    .insert("headers".into(), JsonValue::Object(headers_json));
            }
            if rr_providers & REQUEST_BODY != 0 {
                let body_string = body_value.as_ref().map(json_value_to_string)
                    .unwrap_or_else(|| "".into())
                    .into();
                request_provider.as_object_mut().unwrap()
                    .insert("body".into(), body_string);
            }
            template_values.insert("request".into(), request_provider);
            let response_future = client.request(request);
            let now = Instant::now();
            let open_requests = open_requests.clone();
            let _open_requests2 = open_requests.clone();
            let stats_id = stats_id.clone();
            let stats_tx = stats_tx.clone();
            let method = method.clone();
            let outgoing = outgoing.clone();
            let test_timeout = test_timeout.clone();
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
                    let status_code = response.status();
                    let status = status_code.as_u16();
                    let response_provider = json::json!({"status": status });
                    template_values.insert("response".into(), response_provider);
                    let mut response_fields_added = 0b000_111;
                    handle_response_requirements(
                        precheck_rr_providers,
                        &mut response_fields_added,
                        template_values.get_mut("response").unwrap().as_object_mut().unwrap(),
                        &response
                    );
                    let included_outgoing_indexes: Vec<_> = outgoing.iter().enumerate().filter_map(|(i, (select, _))| {
                        if select.get_where_rr_providers() & RESPONSE_BODY == RESPONSE_BODY || select.execute_where(template_values.as_json()) {
                            handle_response_requirements(
                                select.get_rr_providers(),
                                &mut response_fields_added,
                                template_values.get_mut("response").unwrap().as_object_mut().unwrap(),
                                &response
                            );
                            Some(i)
                        } else {
                            None
                        }
                    }).collect();
                    let body_stream =
                        if response_fields_added & RESPONSE_BODY != 0 {
                            Either::A(
                                response.into_body()
                                    .concat2()
                                    .and_then(|body| {
                                        let s = str::from_utf8(&body).expect("error parsing body as utf8");
                                        let value = if let Ok(value) = json::from_str(s) {
                                            value
                                        } else {
                                            JsonValue::String(s.into())
                                        };
                                        Ok(Some(value))
                                    })
                            )
                        } else {
                            // if we don't need the body, skip parsing it
                            Either::B(
                                response.into_body()
                                    .for_each(|_| Ok(()))
                                    .and_then(|_| Ok(None))
                            )
                        };
                    body_stream
                        .then(move |result| {
                            // open_requests.fetch_sub(1, Ordering::Relaxed);
                            let rtt = (duration_to_nanos(&now.elapsed()) / 1_000_000) as u64;
                            let mut futures = Vec::new();
                            match result {
                                Ok(body) => {
                                    if let Some(body) = body {
                                        template_values.get_mut("response").unwrap().as_object_mut().unwrap()
                                            .insert("body".into(), body);
                                    }
                                    for i in included_outgoing_indexes.iter() {
                                        let (v, tx) = outgoing.get(*i).unwrap();
                                        let i = v.as_iter(template_values.as_json().clone());
                                        match v.get_send_behavior() {
                                            EndpointProvidesSendOptions::Block => {
                                                let fut = tx.clone().send_all(stream::iter_ok(i))
                                                    .map(|_| ())
                                                    .map_err(|_| panic!("provider channel should not yet be closed"))
                                                    .select(test_timeout.clone().then(|_| Ok(())))
                                                    .then(|_| Ok(()));
                                                futures.push(Either::A(fut));
                                            },
                                            EndpointProvidesSendOptions::Force =>
                                                i.for_each(|v| tx.force_send(v)),
                                            EndpointProvidesSendOptions::IfNotFull =>
                                                for v in i {
                                                    if tx.try_send(v).is_err() {
                                                        break
                                                    }
                                                },
                                        }
                                    }
                                    futures.push(Either::B(
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

fn handle_response_requirements(
        bitwise: u8,
        response_fields_added: &mut u8,
        rp: &mut json::map::Map<String, JsonValue>,
        response: &Response<HyperBody>,
    )
{
    // check if we need the response startline and it hasn't already been set
    if ((bitwise & RESPONSE_STARTLINE) ^ (*response_fields_added & RESPONSE_STARTLINE)) != 0 {
        *response_fields_added |= RESPONSE_STARTLINE;
        let version = response.version();
        rp.insert("start-line".into(), format!("{:?} {}", version, response.status()).into());
    }
    // check if we need the response headers and it hasn't already been set
    if ((bitwise & RESPONSE_HEADERS) ^ (*response_fields_added & RESPONSE_HEADERS)) != 0 {
        *response_fields_added |= RESPONSE_HEADERS;
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
        rp.insert("headers".into(), JsonValue::Object(headers_json));
    }
    // check if we need the response body and it hasn't already been set
    if ((bitwise & RESPONSE_BODY) ^ (*response_fields_added & RESPONSE_BODY)) != 0 {
        *response_fields_added |= RESPONSE_BODY;
        // the actual adding of the body happens later
    }
}