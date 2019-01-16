use futures::{future::join_all, stream, Sink, Stream};
use hyper::{Body as HyperBody, Method, Request, Response};
use serde_json as json;
use tokio::{
    prelude::*,
    timer::{Error as TimerError, Timeout},
};

use crate::channel;
use crate::config::{
    self, EndpointProvidesSendOptions, Select, Template, REQUEST_BODY, REQUEST_HEADERS,
    REQUEST_STARTLINE, REQUEST_URL, RESPONSE_BODY, RESPONSE_HEADERS, RESPONSE_STARTLINE, STATS,
};
use crate::for_each_parallel::ForEachParallel;
use crate::load_test::LoadTest;
use crate::stats;
use crate::util::{Either, Either3};
use crate::zip_all::zip_all;

use std::{
    collections::{BTreeMap, BTreeSet},
    ops::{Deref, DerefMut},
    str,
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

#[derive(Debug)]
pub struct TemplateValues(json::Value);

impl TemplateValues {
    pub fn new() -> Self {
        TemplateValues(json::Value::Object(json::Map::new()))
    }

    pub fn as_json(&self) -> &json::Value {
        &self.0
    }
}

impl Deref for TemplateValues {
    type Target = json::Map<String, json::Value>;

    fn deref(&self) -> &Self::Target {
        match &self.0 {
            json::Value::Object(o) => o,
            _ => panic!("cannot deref json value as object"),
        }
    }
}

impl DerefMut for TemplateValues {
    fn deref_mut(&mut self) -> &mut json::Map<String, json::Value> {
        match &mut self.0 {
            json::Value::Object(o) => o,
            _ => panic!("cannot deref json value as object"),
        }
    }
}

impl From<json::Value> for TemplateValues {
    fn from(map: json::Value) -> Self {
        TemplateValues(map)
    }
}

struct Outgoing {
    select: Select,
    tx: channel::Sender<json::Value>,
}

impl Outgoing {
    fn new(select: Select, tx: channel::Sender<json::Value>) -> Self {
        Outgoing { select, tx }
    }
}

pub struct Builder<T>
where
    T: Stream<Item = Instant, Error = TimerError> + Send + 'static,
{
    body: Option<String>,
    declare: BTreeMap<String, String>,
    headers: Vec<(String, String)>,
    logs: Vec<(String, Select)>,
    method: Method,
    start_stream: Option<T>,
    provides: Vec<(String, Select)>,
    stats_id: Option<BTreeMap<String, String>>,
    uri: String,
}

// enum ProviderResponse {
//     Channel(channel::Receiver<Vec<u8>>),
//     Value(json::Value),
// }

enum StreamsReturn {
    // Body(ProviderResponse),
    Declare(String, json::Value, Vec<config::AutoReturn>),
    Instant(Instant),
    TemplateValue(String, json::Value, Option<config::AutoReturn>),
}

impl<T> Builder<T>
where
    T: Stream<Item = Instant, Error = TimerError> + Send + 'static,
{
    pub fn new(uri: String, start_stream: Option<T>) -> Self {
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

    pub fn declare(mut self, providers: BTreeMap<String, String>) -> Self {
        self.declare.extend(providers);
        self
    }

    pub fn provides(mut self, providers: Vec<(String, Select)>) -> Self {
        self.provides.extend(providers);
        self
    }

    pub fn logs(mut self, logs: Vec<(String, Select)>) -> Self {
        self.logs.extend(logs);
        self
    }

    pub fn method(mut self, method: Method) -> Self {
        self.method = method;
        self
    }

    pub fn headers(mut self, mut headers: Vec<(String, String)>) -> Self {
        self.headers.append(&mut headers);
        self
    }

    pub fn body(mut self, body: Option<String>) -> Self {
        self.body = body;
        self
    }

    pub fn stats_id(mut self, stats_id: Option<BTreeMap<String, String>>) -> Self {
        self.stats_id = stats_id;
        self
    }

    pub fn build(
        self,
        ctx: &mut LoadTest,
        endpoint_id: usize,
    ) -> (impl Future<Item = (), Error = ()> + Send) {
        let mut streams = Vec::new();
        let has_start_stream = if let Some(start_stream) = self.start_stream {
            streams.push(Either3::A(
                start_stream
                    .map(StreamsReturn::Instant)
                    .map_err(|e| panic!("error from interval stream {}\n", e)),
            ));
            true
        } else {
            false
        };
        let mut required_providers: BTreeSet<String> = BTreeSet::new();
        let uri = Template::new(&self.uri, &ctx.static_providers);
        required_providers.extend(uri.get_providers().clone());
        let headers: BTreeMap<_, _> = self
            .headers
            .into_iter()
            .map(|(key, v)| {
                let value = Template::new(&v, &ctx.static_providers);
                required_providers.extend(value.get_providers().clone());
                (key.to_lowercase(), value)
            })
            .collect();
        let mut limits = Vec::new();
        let mut precheck_rr_providers = 0;
        let mut rr_providers = 0;
        let mut outgoing = Vec::new();
        for (k, v) in self.provides {
            let provider = ctx
                .providers
                .get(&k)
                .unwrap_or_else(|| panic!("undeclared provider `{}`", k));
            let tx = provider.tx.clone();
            if let EndpointProvidesSendOptions::Block = v.get_send_behavior() {
                limits.push(tx.limit());
            }
            rr_providers |= v.get_special_providers();
            precheck_rr_providers |= v.get_where_clause_special_providers();
            required_providers.extend(v.get_providers().clone());
            outgoing.push(Outgoing::new(v, tx));
        }
        for (k, v) in self.logs {
            let (tx, _) = ctx
                .loggers
                .get(&k)
                .unwrap_or_else(|| panic!("undeclared logger `{}`", k));
            rr_providers |= v.get_special_providers();
            precheck_rr_providers |= v.get_where_clause_special_providers();
            required_providers.extend(v.get_providers().clone());
            outgoing.push(Outgoing::new(v, tx.clone()));
        }
        outgoing.extend(ctx.loggers.values().filter_map(|(tx, select)| {
            if let Some(select) = select {
                required_providers.extend(select.get_providers().clone());
                rr_providers |= select.get_special_providers();
                precheck_rr_providers |= select.get_where_clause_special_providers();
                Some(Outgoing::new(select.clone(), tx.clone()))
            } else {
                None
            }
        }));
        let mut body = self.body.map(|body| {
            let value = Template::new(&body, &ctx.static_providers);
            required_providers.extend(value.get_providers().clone());
            value
        });
        {
            let mut required_providers2 = BTreeSet::new();
            for (name, d) in self.declare {
                required_providers.remove(&name);
                let vce = config::ValueOrComplexExpression::new(
                    &d,
                    &mut required_providers2,
                    &ctx.static_providers,
                );
                let stream = vce
                    .into_stream(&ctx.providers)
                    .map(move |(v, returns)| StreamsReturn::Declare(name.clone(), v, returns));
                streams.push(Either3::B(stream));
            }
        }
        // go through the list of required providers and make sure we have them all
        for name in required_providers {
            let provider = ctx
                .providers
                .get(&name)
                .unwrap_or_else(|| panic!("unknown provider `{}`", &name));
            let receiver = provider.rx.clone();
            let ar = provider
                .auto_return
                .map(|send_option| (send_option, provider.tx.clone()));
            let provider_stream = Either3::C(
                Stream::map(receiver, move |v| {
                    let ar = ar
                        .clone()
                        .map(|(send_option, tx)| (send_option, tx, vec![v.clone()]));
                    StreamsReturn::TemplateValue(name.clone(), v, ar)
                })
                .map_err(|_| panic!("error from provider")),
            );
            streams.push(provider_stream);
        }
        let outgoing = Arc::new(outgoing);
        let stats_tx = ctx.stats_tx.clone();
        let client = ctx.client.clone();
        let method = self.method;
        let mut stats_id = self.stats_id.unwrap_or_default();
        for v in stats_id.values_mut() {
            let t = Template::new(&v, &ctx.static_providers);
            if !t.get_providers().is_empty() {
                panic!("stats_id can only reference static providers and environment variables")
            }
            *v = t.evaluate(&json::Value::Null);
        }
        stats_id.insert("url".into(), uri.evaluate_with_star());
        stats_id.insert("method".into(), method.to_string());
        let test_timeout = ctx.test_timeout.clone();
        let streams = zip_all(streams)
            .map_err(|_| panic!("error from zip_all"))
            .select(
                ctx.test_timeout
                    .clone()
                    .into_stream()
                    .map(|_| unreachable!("timeouts only error")),
            );
        let streams = if has_start_stream {
            let mut test_killed = ctx.test_killed_rx.clone();
            Either::A(streams.take_while(move |_| {
                if let Ok(Async::Ready(_)) = test_killed.poll() {
                    Ok(false)
                } else {
                    Ok(true)
                }
            }))
        } else {
            Either::B(streams)
        };
        let timeout = ctx.config.client.request_timeout;
        let init_stats = stats_tx
            .clone()
            .send(
                stats::StatsInit {
                    endpoint_id,
                    time: SystemTime::now(),
                    stats_id,
                }
                .into(),
            )
            .then(|_| Ok(()));
        tokio::spawn(init_stats);
        let work = ForEachParallel::new(limits, streams, move |values| {
            let mut template_values = TemplateValues::new();
            let mut auto_returns = Vec::new();
            for tv in values {
                match tv {
                    StreamsReturn::Declare(name, value, returns) => {
                        template_values.insert(name, value);
                        auto_returns.extend(returns);
                    }
                    StreamsReturn::TemplateValue(name, value, auto_return) => {
                        template_values.insert(name, value);
                        if let Some(ar) = auto_return {
                            auto_returns.push(ar);
                        }
                    },
                    StreamsReturn::Instant(_) => ()
                };
            }
            let mut request = Request::builder();
            let url = uri.evaluate(&template_values.0);
            request.uri(&url);
            request.method(method.clone());
            for (key, v) in &headers {
                let value = v.evaluate(&template_values.0);
                request.header(key.as_str(), value.as_str());
            }
            let mut body_value = None;
            let body = if let Some(b) = body.as_mut() {
                let body = b.evaluate(&template_values.0);
                if rr_providers & REQUEST_BODY != 0 {
                    body_value = Some(body.clone());
                }
                body.into()
            } else {
                HyperBody::empty()
            };
            let request = request.body(body).unwrap();
            let mut request_provider = json::json!({});
            let request_obj = request_provider.as_object_mut().unwrap();
            if rr_providers & REQUEST_URL == REQUEST_URL {
                // add in the url
                let url = url::Url::parse(&url).unwrap();
                let mut protocol: String = url.scheme().into();
                if !protocol.is_empty() {
                    protocol = format!("{}:", protocol);
                }
                let search_params: json::Map<String, json::Value> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned().into())).collect();
                request_obj.insert(
                    "url".into(),
                    json::json!({
                        "hash": url.fragment().map(|s| format!("#{}", s)).unwrap_or_else(|| "".into()),
                        "host": url.host_str().unwrap_or(""),
                        "hostname": url.domain().unwrap_or(""),
                        "href": url.as_str(),
                        "origin": url.origin().unicode_serialization(),
                        "password": url.password().unwrap_or(""),
                        "pathname": url.path(),
                        "port": url.port().map(|n| n.to_string()).unwrap_or_else(|| "".into()),
                        "protocol": protocol,
                        "search": url.query().map(|s| format!("?{}", s)).unwrap_or_else(|| "".into()),
                        "searchParams": search_params,
                        "username": url.username(),
                    })
                );
            }
            if rr_providers & REQUEST_STARTLINE != 0 {
                let uri_path_and_query = request.uri().path_and_query()
                    .map(|pq| pq.as_str())
                    .unwrap_or("/");
                let version = request.version();
                request_obj.insert("start-line".into(), format!("{} {} {:?}", method, uri_path_and_query, version).into());
            }
            if rr_providers & REQUEST_HEADERS != 0 {
                let mut headers_json = json::Map::new();
                for (k, v) in request.headers() {
                    headers_json.insert(
                        k.as_str().to_string(),
                        json::Value::String(
                            v.to_str().expect("could not parse HTTP request header as utf8 string")
                                .to_string()
                        )
                    );
                }
                request_obj.insert("headers".into(), json::Value::Object(headers_json));
            }
            if rr_providers & REQUEST_BODY != 0 {
                let body_string = body_value.unwrap_or_else(|| "".into());
                request_obj.insert("body".into(), body_string.into());
            }
            request_obj.insert("method".into(), method.as_str().into());
            template_values.insert("request".into(), request_provider);
            let response_future = client.request(request);
            let now = Instant::now();
            let stats_tx = stats_tx.clone();
            let stats_tx2 = stats_tx.clone();
            let outgoing = outgoing.clone();
            let test_timeout = test_timeout.clone();
            let test_timeout2 = test_timeout.clone();
            let timeout_in_ms = (duration_to_nanos(&now.elapsed()) / 1_000_000) as u64;
            Timeout::new(response_future, timeout)
                .map_err(move |err| {
                    if let Some(err) = err.into_inner() {
                        let mut description = None;
                        if let Some(io_error_maybe) = err.cause2() {
                            if let Some(io_error) = io_error_maybe.downcast_ref::<std::io::Error>() {
                                description = Some(format!("{}", io_error));
                            }
                        }
                        let description = description.unwrap_or_else(|| format!("{}", err));
                        let task = stats_tx2.send(
                            stats::ResponseStat {
                                endpoint_id,
                                kind: stats::StatKind::ConnectionError(description),
                                time: SystemTime::now(),
                            }.into()
                        ).then(|_| Ok(()));
                        tokio::spawn(task);
                    } else {
                        let task = stats_tx2.send(
                            stats::ResponseStat {
                                endpoint_id,
                                kind: stats::StatKind::Timeout(timeout_in_ms),
                                time: SystemTime::now(),
                            }.into()
                        ).then(|_| Ok(()));
                        tokio::spawn(task);
                    }
                })
                .and_then(move |response| {
                    let status_code = response.status();
                    let status = status_code.as_u16();
                    let response_provider = json::json!({ "status": status });
                    template_values.insert("response".into(), response_provider);
                    let mut response_fields_added = 0b000_111;
                    handle_response_requirements(
                        precheck_rr_providers,
                        &mut response_fields_added,
                        template_values.get_mut("response").unwrap().as_object_mut().unwrap(),
                        &response
                    );
                    let included_outgoing_indexes: Vec<_> = outgoing.iter().enumerate().filter_map(|(i, o)| {
                        let where_clause_special_providers = o.select.get_where_clause_special_providers();
                        if where_clause_special_providers & RESPONSE_BODY == RESPONSE_BODY
                            || where_clause_special_providers & STATS == STATS
                            || o.select.execute_where(template_values.as_json()) {
                            handle_response_requirements(
                                o.select.get_special_providers(),
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
                                            json::Value::String(s.into())
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
                            let rtt = (duration_to_nanos(&now.elapsed()) / 1_000_000) as u64;
                            let mut futures = Vec::new();
                            template_values.insert("stats".into(), json::json!({ "rtt": rtt }));
                            match result {
                                Ok(body) => {
                                    if let Some(body) = body {
                                        template_values.get_mut("response").unwrap().as_object_mut().unwrap()
                                            .insert("body".into(), body);
                                    }
                                    for i in included_outgoing_indexes.iter() {
                                        let o = outgoing.get(*i).unwrap();
                                        let i = o.select.as_iter(template_values.as_json().clone());
                                        match o.select.get_send_behavior() {
                                            EndpointProvidesSendOptions::Block => {
                                                let fut = o.tx.clone().send_all(stream::iter_ok(i))
                                                    .map(|_| ())
                                                    .map_err(|_| panic!("provider channel should not yet be closed"))
                                                    .select(test_timeout.clone().then(|_| Ok(())))
                                                    .then(|_| Ok(()));
                                                futures.push(Either::A(fut));
                                            },
                                            EndpointProvidesSendOptions::Force =>
                                                i.for_each(|v| o.tx.force_send(v)),
                                            EndpointProvidesSendOptions::IfNotFull =>
                                                for v in i {
                                                    if o.tx.try_send(v).is_err() {
                                                        break
                                                    }
                                                },
                                        }
                                    }
                                    futures.push(Either::B(
                                        stats_tx.send(
                                            stats::ResponseStat {
                                                endpoint_id,
                                                kind: stats::StatKind::Rtt((rtt, status)),
                                                time: SystemTime::now(),
                                            }.into()
                                        )
                                        .map(|_| ())
                                        .map_err(|e| panic!("unexpected error trying to send stats, {}", e))
                                    ));
                                },
                                Err(ref err) => eprint!("{}", format!("err getting body: {:?}\n took {}ms\n", err, rtt))
                            }
                            join_all(futures)
                                .map(|_| ())
                        })
                // all error cases should have been handled before catching them here
                }).then(move |_| {
                    let mut futures = Vec::new();
                    for (send_option, channel, jsons) in auto_returns {
                        match send_option {
                            EndpointProvidesSendOptions::Block => {
                                let fut = channel.send_all(stream::iter_ok(jsons))
                                    .map(|_| ())
                                    .map_err(|_| panic!("provider channel should not yet be closed"))
                                    .select(test_timeout2.clone().then(|_| Ok(())))
                                    .map(|_| ()).map_err(|_| ());
                                futures.push(fut);
                            },
                            EndpointProvidesSendOptions::Force =>
                                jsons.into_iter().for_each(|v| channel.force_send(v)),
                            EndpointProvidesSendOptions::IfNotFull =>
                                for v in jsons {
                                    if channel.try_send(v).is_err() {
                                        break
                                    }
                                },
                        }
                    }
                join_all(futures).then(|_| Ok(()))
            })
        })
        // errors should only propogate this far due to test timeout
        .then(|_| Ok(()));
        if has_start_stream {
            Either::A(work)
        } else {
            let test_killed = ctx.test_killed_rx.clone().then(|_| Ok(()));
            Either::B(work.select(test_killed).map(|_| ()).map_err(|_| ()))
        }
    }
}

fn duration_to_nanos(d: &Duration) -> u128 {
    u128::from(d.as_secs()) * 1_000_000_000 + u128::from(d.subsec_nanos())
}

fn handle_response_requirements(
    bitwise: u16,
    response_fields_added: &mut u16,
    rp: &mut json::map::Map<String, json::Value>,
    response: &Response<HyperBody>,
) {
    // check if we need the response startline and it hasn't already been set
    if ((bitwise & RESPONSE_STARTLINE) ^ (*response_fields_added & RESPONSE_STARTLINE)) != 0 {
        *response_fields_added |= RESPONSE_STARTLINE;
        let version = response.version();
        rp.insert(
            "start-line".into(),
            format!("{:?} {}", version, response.status()).into(),
        );
    }
    // check if we need the response headers and it hasn't already been set
    if ((bitwise & RESPONSE_HEADERS) ^ (*response_fields_added & RESPONSE_HEADERS)) != 0 {
        *response_fields_added |= RESPONSE_HEADERS;
        let mut headers_json = json::Map::new();
        for (k, v) in response.headers() {
            headers_json.insert(
                k.as_str().to_string(),
                json::Value::String(
                    v.to_str()
                        .expect("could not parse HTTP response header as utf8 string")
                        .to_string(),
                ),
            );
        }
        rp.insert("headers".into(), json::Value::Object(headers_json));
    }
    // check if we need the response body and it hasn't already been set
    if ((bitwise & RESPONSE_BODY) ^ (*response_fields_added & RESPONSE_BODY)) != 0 {
        *response_fields_added |= RESPONSE_BODY;
        // the actual adding of the body happens later
    }
}
