use ether::{Either, Either3};
use for_each_parallel::ForEachParallel;
use futures::{
    future::join_all, stream, sync::mpsc as futures_channel, Async, Future, IntoFuture, Sink,
    Stream,
};
use hyper::{
    body::Payload,
    client::HttpConnector,
    header::{
        Entry as HeaderEntry, HeaderMap, HeaderName, HeaderValue, CONTENT_DISPOSITION,
        CONTENT_LENGTH, CONTENT_TYPE, HOST,
    },
    Body as HyperBody, Client, Method, Request, Response,
};
use hyper_tls::HttpsConnector;
use parking_lot::Mutex;
use rand::distributions::{Alphanumeric, Distribution};
use select_any::select_any;
use serde_json as json;
use tokio::{io::AsyncRead, timer::Timeout};
use zip_all::zip_all;

use crate::config::{
    self, AutoReturn, EndpointProvidesSendOptions, Select, Template, REQUEST_BODY, REQUEST_HEADERS,
    REQUEST_STARTLINE, REQUEST_URL, RESPONSE_BODY, RESPONSE_HEADERS, RESPONSE_STARTLINE, STATS,
};
use crate::error::{RecoverableError, TestError};
use crate::providers;
use crate::stats;
use crate::util::tweak_path;

use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error as StdError,
    num::NonZeroUsize,
    ops::{Deref, DerefMut},
    path::PathBuf,
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
            _ => unreachable!("cannot deref json value as object"),
        }
    }
}

impl DerefMut for TemplateValues {
    fn deref_mut(&mut self) -> &mut json::Map<String, json::Value> {
        match &mut self.0 {
            json::Value::Object(o) => o,
            _ => unreachable!("cannot deref json value as object"),
        }
    }
}

impl From<json::Value> for TemplateValues {
    fn from(map: json::Value) -> Self {
        TemplateValues(map)
    }
}

struct Outgoing {
    cb: Option<Arc<dyn Fn() + Send + Sync + 'static>>,
    select: Select,
    tx: channel::Sender<json::Value>,
}

impl Outgoing {
    fn new(
        select: Select,
        tx: channel::Sender<json::Value>,
        cb: Option<Arc<dyn Fn() + Send + Sync + 'static>>,
    ) -> Self {
        Outgoing { cb, select, tx }
    }
}

type StartStream = Box<dyn Stream<Item = Instant, Error = TestError> + Send>;

pub struct BuilderContext {
    pub config: config::Config,
    pub config_path: PathBuf,
    // the http client
    pub client: Arc<
        Client<
            HttpsConnector<HttpConnector<hyper::client::connect::dns::TokioThreadpoolGaiResolver>>,
        >,
    >,
    // a mapping of names to their prospective static (single value) providers
    pub static_providers: BTreeMap<String, json::Value>,
    // a mapping of names to their prospective providers
    pub providers: BTreeMap<String, providers::Provider>,
    // a mapping of names to their prospective loggers
    pub loggers: BTreeMap<String, (channel::Sender<json::Value>, Option<config::Select>)>,
    // channel that receives and aggregates stats for the test
    pub stats_tx: StatsTx,
}

pub struct Builder {
    body: Option<config::Body>,
    declare: BTreeMap<String, String>,
    headers: Vec<(String, String)>,
    logs: Vec<(String, Select)>,
    max_parallel_requests: Option<NonZeroUsize>,
    method: Method,
    on_demand: bool,
    provides: Vec<(String, Select)>,
    start_stream: Option<StartStream>,
    stats_id: Option<BTreeMap<String, String>>,
    url: String,
}

impl Builder {
    pub fn new(url: String, start_stream: Option<StartStream>) -> Self {
        Builder {
            body: None,
            declare: BTreeMap::new(),
            headers: Vec::new(),
            logs: Vec::new(),
            max_parallel_requests: None,
            method: Method::GET,
            on_demand: false,
            start_stream,
            provides: Vec::new(),
            stats_id: None,
            url,
        }
    }

    pub fn declare(mut self, providers: BTreeMap<String, String>) -> Self {
        self.declare.extend(providers);
        self
    }

    pub fn provides(mut self, provides: Vec<(String, Select)>) -> Self {
        self.provides = provides;
        self
    }

    pub fn logs(mut self, logs: Vec<(String, Select)>) -> Self {
        self.logs.extend(logs);
        self
    }

    pub fn max_parallel_requests(mut self, max_parallel_requests: Option<NonZeroUsize>) -> Self {
        self.max_parallel_requests = max_parallel_requests;
        self
    }

    pub fn method(mut self, method: Method) -> Self {
        self.method = method;
        self
    }

    pub fn on_demand(mut self, on_demand: bool) -> Self {
        self.on_demand = on_demand;
        self
    }

    pub fn headers(mut self, mut headers: Vec<(String, String)>) -> Self {
        self.headers.append(&mut headers);
        self
    }

    pub fn body(mut self, body: Option<config::Body>) -> Self {
        self.body = body;
        self
    }

    pub fn stats_id(mut self, stats_id: Option<BTreeMap<String, String>>) -> Self {
        self.stats_id = stats_id;
        self
    }

    pub fn build(
        self,
        ctx: &mut BuilderContext,
        endpoint_id: usize,
    ) -> Result<Endpoint, TestError> {
        let mut streams = Vec::new();
        if let Some(start_stream) = self.start_stream {
            streams.push(Either3::A(start_stream.map(|_| StreamItem::None)));
        };
        let mut required_providers: BTreeSet<String> = BTreeSet::new();
        let url = Template::new(&self.url, &ctx.static_providers)?;
        required_providers.extend(url.get_providers().clone());
        let headers: BTreeMap<_, _> = self
            .headers
            .into_iter()
            .map(|(key, v)| {
                let value = Template::new(&v, &ctx.static_providers)?;
                required_providers.extend(value.get_providers().clone());
                Ok::<_, TestError>((key.to_lowercase(), value))
            })
            .collect::<Result<_, _>>()?;
        let mut limits = Vec::new();
        let mut precheck_rr_providers = 0;
        let mut rr_providers = 0;
        let mut outgoing = Vec::new();
        let mut on_demand_streams = Vec::new();
        for (k, v) in self.provides {
            let provider = ctx
                .providers
                .get(&k)
                .ok_or_else(|| TestError::UnknownProvider(k))?;
            let tx = provider.tx.clone();
            if let EndpointProvidesSendOptions::Block = v.get_send_behavior() {
                limits.push(tx.limit());
            }
            rr_providers |= v.get_special_providers();
            precheck_rr_providers |= v.get_where_clause_special_providers();
            required_providers.extend(v.get_providers().clone());
            let cb = if self.on_demand {
                let (stream, cb) = provider.on_demand.clone().into_stream();
                on_demand_streams.push(stream);
                Some(cb)
            } else {
                None
            };
            outgoing.push(Outgoing::new(v, tx, cb));
        }
        for (k, v) in self.logs {
            let (tx, _) = ctx
                .loggers
                .get(&k)
                .ok_or_else(|| TestError::UnknownLogger(k))?;
            rr_providers |= v.get_special_providers();
            precheck_rr_providers |= v.get_where_clause_special_providers();
            required_providers.extend(v.get_providers().clone());
            outgoing.push(Outgoing::new(v, tx.clone(), None));
        }
        outgoing.extend(ctx.loggers.values().filter_map(|(tx, select)| {
            if let Some(select) = select {
                required_providers.extend(select.get_providers().clone());
                rr_providers |= select.get_special_providers();
                precheck_rr_providers |= select.get_where_clause_special_providers();
                Some(Outgoing::new(select.clone(), tx.clone(), None))
            } else {
                None
            }
        }));
        let body = self
            .body
            .map(|body| {
                let value = match body {
                    config::Body::File(body) => {
                        let template = Template::new(&body, &ctx.static_providers)?;
                        required_providers.extend(template.get_providers().clone());
                        BodyTemplate::File(ctx.config_path.clone(), template)
                    }
                    config::Body::String(body) => {
                        let template = Template::new(&body, &ctx.static_providers)?;
                        required_providers.extend(template.get_providers().clone());
                        BodyTemplate::String(template)
                    }
                    config::Body::Multipart(multipart) => {
                        let pieces = multipart
                            .into_iter()
                            .map(|(name, v)| {
                                let (is_file, template) = match v.body {
                                    config::BodyMultipartPieceBody::File(f) => {
                                        let template = Template::new(&f, &ctx.static_providers)?;
                                        required_providers.extend(template.get_providers().clone());
                                        (true, template)
                                    }
                                    config::BodyMultipartPieceBody::String(s) => {
                                        let template = Template::new(&s, &ctx.static_providers)?;
                                        required_providers.extend(template.get_providers().clone());
                                        (false, template)
                                    }
                                };
                                let headers = v
                                    .headers
                                    .into_iter()
                                    .map(|(k, v)| {
                                        let template = Template::new(&v, &ctx.static_providers)?;
                                        required_providers.extend(template.get_providers().clone());
                                        Ok::<_, TestError>((k, template))
                                    })
                                    .collect::<Result<_, _>>()?;

                                let piece = MultipartPiece {
                                    name,
                                    headers,
                                    is_file,
                                    template,
                                };
                                Ok::<_, TestError>(piece)
                            })
                            .collect::<Result<_, _>>()?;
                        let multipart = MultipartBody {
                            path: ctx.config_path.clone(),
                            pieces,
                        };
                        BodyTemplate::Multipart(multipart)
                    }
                };
                Ok::<_, TestError>(value)
            })
            .transpose()?
            .unwrap_or(BodyTemplate::None);
        let mut required_providers2 = BTreeSet::new();
        for (name, d) in self.declare {
            required_providers.remove(&name);
            let vce = config::ValueOrExpression::new(
                &d,
                &mut required_providers2,
                &ctx.static_providers,
            )?;
            let stream = vce
                .into_stream(&ctx.providers)
                .map(move |(v, returns)| StreamItem::Declare(name.clone(), v, returns));
            streams.push(Either3::B(stream));
        }
        // go through the list of required providers and make sure we have them all
        for name in &required_providers {
            let provider = ctx
                .providers
                .get(name)
                .ok_or_else(|| TestError::UnknownProvider(name.clone()))?;
            let receiver = provider.rx.clone();
            let ar = provider
                .auto_return
                .map(|send_option| (send_option, provider.tx.clone()));
            let name = name.clone();
            let provider_stream = Either3::C(
                Stream::map(receiver, move |v| {
                    let ar = ar
                        .clone()
                        .map(|(send_option, tx)| AutoReturn::new(send_option, tx, vec![v.clone()]));
                    StreamItem::TemplateValue(name.clone(), v, ar)
                })
                .map_err(|_| TestError::Internal("Unexpected error from receiver".into())),
            );
            streams.push(provider_stream);
        }
        required_providers.extend(required_providers2);
        let outgoing = Arc::new(outgoing);
        let stats_tx = ctx.stats_tx.clone();
        let client = ctx.client.clone();
        let method = self.method;
        let mut stats_id = self.stats_id.unwrap_or_default();
        for v in stats_id.values_mut() {
            let t = Template::new(&v, &ctx.static_providers)?;
            if let Some(r) = t.get_providers().iter().nth(0) {
                return Err(TestError::InvalidStatsIdReference(r.clone()));
            }
            *v = t.evaluate(&json::Value::Null)?;
        }
        stats_id.insert("url".into(), url.evaluate_with_star());
        stats_id.insert("method".into(), method.to_string());
        // using existential types here to avoid the boxed stream causes ICE https://github.com/rust-lang/rust/issues/54899
        let stream: EndpointStream = if !on_demand_streams.is_empty() {
            let mut on_demand_streams = select_any(on_demand_streams);
            let mut zipped_streams = zip_all(streams);
            let mut od_continue = false;
            let stream = stream::poll_fn(move || {
                let p = on_demand_streams.poll();
                if !od_continue {
                    match p {
                        Ok(Async::Ready(Some(_))) => od_continue = true,
                        Ok(Async::Ready(None)) => return Ok(Async::Ready(None)),
                        Ok(Async::NotReady) => return Ok(Async::NotReady),
                        Err(_) => {
                            return Err(TestError::Internal(
                                "on demand streams should never error".into(),
                            ));
                        }
                    }
                }
                let p = zipped_streams.poll();
                match p {
                    Ok(Async::NotReady) => (),
                    _ => {
                        od_continue = false;
                    }
                }
                p
            });
            Box::new(stream)
        } else {
            Box::new(zip_all(streams))
        };
        let timeout = ctx.config.client.request_timeout;
        Ok(Endpoint {
            body,
            client,
            endpoint_id,
            headers,
            limits,
            max_parallel_requests: self.max_parallel_requests,
            method,
            outgoing,
            precheck_rr_providers,
            required_providers,
            rr_providers,
            stats_id,
            stats_tx,
            stream,
            url,
            timeout,
        })
    }
}

enum StreamItem {
    Declare(String, json::Value, Vec<config::AutoReturn>),
    None,
    TemplateValue(String, json::Value, Option<config::AutoReturn>),
}

struct MultipartPiece {
    name: String,
    headers: Vec<(String, Template)>,
    is_file: bool,
    template: Template,
}

struct MultipartBody {
    path: PathBuf,
    pieces: Vec<MultipartPiece>,
}

impl MultipartBody {
    fn as_hyper_body<'a>(
        &self,
        template_values: &TemplateValues,
        ct_entry: HeaderEntry<'a, HeaderValue>,
    ) -> Result<HyperBody, TestError> {
        let boundary: String = Alphanumeric
            .sample_iter(&mut rand::thread_rng())
            .take(20)
            .collect();
        let is_form = {
            let content_type =
                ct_entry.or_insert_with(|| HeaderValue::from_static("multipart/form-data"));
            let ct_str = content_type
                .to_str()
                .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
            if ct_str.starts_with("multipart/") {
                let is_form = ct_str.starts_with("multipart/form-data");
                *content_type = HeaderValue::from_str(&format!("{};boundary={}", ct_str, boundary))
                    .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                is_form
            } else {
                *content_type =
                    HeaderValue::from_str(&format!("multipart/form-data;boundary={}", boundary))
                        .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                true
            }
        };
        let mut pieces: Vec<_> = self
            .pieces
            .iter()
            .rev()
            .map(|mp| {
                let body = mp.template.evaluate(&template_values.0)?;
                let mut headers = mp
                    .headers
                    .iter()
                    .map(|(k, t)| {
                        let key = HeaderName::from_bytes(k.as_bytes())
                            .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                        let value = HeaderValue::from_str(&t.evaluate(&template_values.0)?)
                            .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                        Ok::<_, TestError>((key, value))
                    })
                    .collect::<Result<HeaderMap<_>, _>>()?;

                if is_form && !headers.contains_key(CONTENT_DISPOSITION) {
                    let value = HeaderValue::from_str(&format!("form-data; name=\"{}\"", mp.name))
                        .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                    headers.insert(CONTENT_DISPOSITION, value);
                }
                Ok((headers, mp.is_file, body))
            })
            .collect::<Result<_, TestError>>()?;

        let mut sub_body: Option<HyperBody> = None;
        let path = self.path.clone();
        let mut ended = false;
        let mut buf = bytes::BytesMut::with_capacity(8192);

        let stream = stream::poll_fn::<_, TestError, _>(move || loop {
            if let Some(ref mut sb) = &mut sub_body {
                match sb.poll_data() {
                    Ok(Async::Ready(Some(d))) => {
                        buf.extend_from_slice(&*d);
                    }
                    Ok(Async::Ready(None)) => {
                        sub_body = None;
                        buf.extend_from_slice(b"\r\n");
                    }
                    Ok(Async::NotReady) => {
                        return if buf.is_empty() {
                            Ok(Async::NotReady)
                        } else {
                            Ok(Async::Ready(Some(buf.take().freeze())))
                        };
                    }
                    Err(e) => return Err(RecoverableError::BodyErr(Arc::new(e)).into()),
                }
                continue;
            }
            match pieces.pop() {
                Some((headers, is_file, body)) => {
                    buf.extend_from_slice(format!("--{}", boundary).as_bytes());
                    for (k, v) in headers.iter() {
                        buf.extend_from_slice(format!("\r\n{}: ", k.as_str()).as_bytes());
                        buf.extend_from_slice(v.as_bytes());
                    }
                    buf.extend_from_slice(b"\r\n\r\n");
                    if is_file {
                        sub_body = Some(create_file_hyper_body(body, &path));
                    } else {
                        buf.extend_from_slice(body.as_bytes());
                        buf.extend_from_slice(b"\r\n");
                    }
                }
                None => {
                    if buf.is_empty() {
                        return if ended {
                            Ok(Async::Ready(None))
                        } else {
                            buf.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());
                            ended = true;
                            Ok(Async::Ready(Some(buf.take().freeze())))
                        };
                    } else {
                        return Ok(Async::Ready(Some(buf.take().freeze())));
                    }
                }
            }
        });

        Ok(HyperBody::wrap_stream(stream))
    }
}

fn create_file_hyper_body(mut file: String, path: &PathBuf) -> HyperBody {
    tweak_path(&mut file, path);
    let stream = tokio::fs::File::open(file)
        .and_then(|mut file| {
            let mut buf = bytes::BytesMut::with_capacity(8 * (1 << 10));
            let s = stream::poll_fn(move || {
                buf.reserve(8 * (1 << 10));
                let ret = match file.read_buf(&mut buf)? {
                    Async::Ready(n) if n == 0 => Async::Ready(None),
                    Async::Ready(_) => Async::Ready(buf.take().freeze().into()),
                    Async::NotReady => Async::NotReady,
                };
                Ok(ret)
            });
            Ok(s)
        })
        .flatten_stream();
    HyperBody::wrap_stream(stream)
}

enum BodyTemplate {
    File(PathBuf, Template),
    Multipart(MultipartBody),
    None,
    String(Template),
}

impl BodyTemplate {
    fn as_hyper_body<'a>(
        &self,
        template_values: &TemplateValues,
        copy_body_value: bool,
        body_value: &mut Option<String>,
        ct_entry: HeaderEntry<'a, HeaderValue>,
    ) -> Result<HyperBody, TestError> {
        let template = match self {
            BodyTemplate::File(_, t) => t,
            BodyTemplate::Multipart(m) => return m.as_hyper_body(template_values, ct_entry),
            BodyTemplate::None => return Ok(HyperBody::empty()),
            BodyTemplate::String(t) => t,
        };
        let body = template.evaluate(&template_values.0)?;
        if let BodyTemplate::File(path, _) = self {
            Ok(create_file_hyper_body(body, path))
        } else {
            if copy_body_value {
                *body_value = Some(body.clone());
            }
            Ok(body.into())
        }
    }
}

type EndpointStream = Box<dyn Stream<Item = Vec<StreamItem>, Error = TestError> + 'static + Send>;
pub type StatsTx = futures_channel::UnboundedSender<stats::StatsMessage>;

pub struct Endpoint {
    body: BodyTemplate,
    client: Arc<
        Client<
            HttpsConnector<HttpConnector<hyper::client::connect::dns::TokioThreadpoolGaiResolver>>,
        >,
    >,
    endpoint_id: usize,
    headers: BTreeMap<String, Template>,
    limits: Vec<channel::Limit>,
    max_parallel_requests: Option<NonZeroUsize>,
    method: Method,
    outgoing: Arc<Vec<Outgoing>>,
    precheck_rr_providers: u16,
    rr_providers: u16,
    pub required_providers: BTreeSet<String>,
    stats_id: BTreeMap<String, String>,
    stats_tx: StatsTx,
    stream: EndpointStream,
    timeout: Duration,
    url: Template,
}

// This returns a boxed future because otherwise the type system runs out of memory for the type
impl Endpoint {
    pub fn into_future(self) -> Box<dyn Future<Item = (), Error = TestError> + Send> {
        Box::new(
            self.stats_tx
                .clone()
                .send(
                    stats::StatsInit {
                        endpoint_id: self.endpoint_id,
                        time: SystemTime::now(),
                        stats_id: self.stats_id.clone(),
                    }
                    .into(),
                )
                .map_err(|_| TestError::Other("could not send init stats".into()))
                .and_then(move |_| {
                    let rm = RequestMaker {
                        url: self.url,
                        method: self.method,
                        headers: self.headers,
                        body: self.body,
                        rr_providers: self.rr_providers,
                        client: self.client,
                        stats_tx: self.stats_tx,
                        outgoing: self.outgoing,
                        precheck_rr_providers: self.precheck_rr_providers,
                        endpoint_id: self.endpoint_id,
                        timeout: self.timeout,
                    };
                    ForEachParallel::new(
                        self.limits,
                        self.max_parallel_requests,
                        self.stream,
                        move |values| rm.send_requests(values),
                    )
                }),
        )
    }
}

struct RequestMaker {
    url: Template,
    method: Method,
    headers: BTreeMap<String, Template>,
    body: BodyTemplate,
    rr_providers: u16,
    client: Arc<
        Client<
            HttpsConnector<HttpConnector<hyper::client::connect::dns::TokioThreadpoolGaiResolver>>,
        >,
    >,
    stats_tx: StatsTx,
    outgoing: Arc<Vec<Outgoing>>,
    precheck_rr_providers: u16,
    endpoint_id: usize,
    timeout: Duration,
}

impl RequestMaker {
    fn send_requests(&self, values: Vec<StreamItem>) -> impl Future<Item = (), Error = TestError> {
        let mut template_values = TemplateValues::new();
        let mut auto_returns = Vec::new();
        for tv in values {
            match tv {
                StreamItem::Declare(name, value, returns) => {
                    template_values.insert(name, value);
                    auto_returns.extend(returns.into_iter().map(|ar| ar.into_future()));
                }
                StreamItem::None => (),
                StreamItem::TemplateValue(name, value, auto_return) => {
                    template_values.insert(name, value);
                    if let Some(ar) = auto_return {
                        auto_returns.push(ar.into_future());
                    }
                }
            };
        }
        let auto_returns: Arc<_> =
            Mutex::new(Some(join_all(auto_returns).map(|_| ()).map_err(|_| {
                TestError::Internal("auto returns should never error".into())
            })))
            .into();
        let mut request = Request::builder();
        let url = match self.url.evaluate(&template_values.0) {
            Ok(u) => u,
            Err(e) => return Either::B(Err(e).into_future()),
        };
        let url = match url::Url::parse(&url) {
            Ok(u) => {
                // set the request url from the parsed url because it will have
                // some characters percent encoded automatically which otherwise
                // cause hyper to error
                request.uri(u.as_str());
                u
            }
            Err(_) => return Either::B(Err(TestError::InvalidUrl(url)).into_future()),
        };
        request.method(self.method.clone());
        let headers = self
            .headers
            .iter()
            .map(|(k, v)| {
                let key = HeaderName::from_bytes(k.as_bytes())
                    .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                let value = HeaderValue::from_str(&v.evaluate(&template_values.0)?)
                    .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                Ok::<_, TestError>((key, value))
            })
            .collect::<Result<HeaderMap<_>, _>>();
        let mut headers = match headers {
            Ok(h) => h,
            Err(e) => return Either::B(Err(e).into_future()),
        };
        let ct_entry = headers
            .entry(CONTENT_TYPE)
            .expect("Content-Type is a valid header name");
        let mut body_value = None;
        let body = self.body.as_hyper_body(
            &template_values,
            self.rr_providers & REQUEST_BODY != 0,
            &mut body_value,
            ct_entry,
        );
        let body = match body {
            Ok(b) => b,
            Err(e) => return Either::B(Err(e).into_future()),
        };
        let mut request = match request.body(body) {
            Ok(b) => b,
            Err(e) => return Either::B(Err(TestError::RequestBuilderErr(e.into())).into_future()),
        };
        // add the host header
        headers.insert(
            HOST,
            HeaderValue::from_str(url.host_str().expect("should be a valid url"))
                .expect("url should be a valid string"),
        );
        // add the content-lengh header, if needed
        // (hyper adds it automatically but we need to add it manually here so it shows up in the logs)
        match request.body().content_length() {
            Some(n) if n > 0 => {
                headers.insert(CONTENT_LENGTH, n.into());
            }
            _ => (),
        }
        let mut request_provider = json::json!({});
        let request_obj = request_provider
            .as_object_mut()
            .expect("should be a json object");
        if self.rr_providers & REQUEST_URL == REQUEST_URL {
            // add in the url
            let mut protocol: String = url.scheme().into();
            if !protocol.is_empty() {
                protocol = format!("{}:", protocol);
            }
            let search_params: json::Map<String, json::Value> = url
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned().into()))
                .collect();
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
                }),
            );
        }
        if self.rr_providers & REQUEST_STARTLINE != 0 {
            let url_path_and_query = request
                .uri()
                .path_and_query()
                .map(|pq| pq.as_str())
                .unwrap_or("/");
            let version = request.version();
            request_obj.insert(
                "start-line".into(),
                format!("{} {} {:?}", self.method, url_path_and_query, version).into(),
            );
        }
        if self.rr_providers & REQUEST_HEADERS != 0 {
            let mut headers_json = json::Map::new();
            for (k, v) in headers.iter() {
                headers_json.insert(
                    k.as_str().to_string(),
                    json::Value::String(
                        v.to_str()
                            .expect("could not parse HTTP request header as utf8 string")
                            .to_string(),
                    ),
                );
            }
            request_obj.insert("headers".into(), json::Value::Object(headers_json));
        }
        if self.rr_providers & REQUEST_BODY != 0 {
            let body_string = body_value.unwrap_or_else(|| "".into());
            request_obj.insert("body".into(), body_string.into());
        }
        request_obj.insert("method".into(), self.method.as_str().into());
        template_values.insert("request".into(), request_provider);
        request.headers_mut().extend(headers);
        let response_future = self.client.request(request);
        let now = Instant::now();
        let stats_tx = self.stats_tx.clone();
        let stats_tx2 = stats_tx.clone();
        let outgoing = self.outgoing.clone();
        let outgoing2 = outgoing.clone();
        let timeout_in_micros = self.timeout.as_micros() as u64;
        let precheck_rr_providers = self.precheck_rr_providers;
        let endpoint_id = self.endpoint_id;

        let auto_returns2 = auto_returns.clone();
        let a = Timeout::new(response_future, self.timeout)
            .map_err(move |err| {
                if let Some(err) = err.into_inner() {
                    let err: Arc<dyn StdError + Send + Sync> =
                        if let Some(io_error_maybe) = err.source() {
                            if io_error_maybe.downcast_ref::<std::io::Error>().is_some() {
                                let io_error = err.into_cause().expect("should have a cause error");
                                Arc::new(
                                    *io_error
                                        .downcast::<std::io::Error>()
                                        .expect("should downcast as io error"),
                                )
                            } else {
                                Arc::new(err)
                            }
                        } else {
                            Arc::new(err)
                        };
                    RecoverableError::ConnectionErr(SystemTime::now(), err).into()
                } else {
                    RecoverableError::Timeout(SystemTime::now()).into()
                }
            })
            .and_then(move |response| {
                let rh = ResponseHandler {
                    template_values,
                    precheck_rr_providers,
                    outgoing,
                    now,
                    stats_tx,
                    endpoint_id,
                };
                rh.handle(response, auto_returns)
            })
            .or_else(move |te| match te {
                TestError::Recoverable(r) => {
                    let time = match r {
                        RecoverableError::Timeout(t) | RecoverableError::ConnectionErr(t, _) => t,
                        _ => SystemTime::now(),
                    };
                    let rtt = match r {
                        RecoverableError::Timeout(_) => Some(timeout_in_micros),
                        _ => None,
                    };
                    for o in outgoing2.iter() {
                        if let Some(cb) = &o.cb {
                            cb();
                        }
                    }
                    let a = stats_tx2
                        .send(
                            stats::ResponseStat {
                                endpoint_id,
                                kind: stats::StatKind::RecoverableError(r),
                                rtt,
                                time,
                            }
                            .into(),
                        )
                        .then(|_| Ok(()));
                    Either::A(a)
                }
                _ => Either::B(Err(te).into_future()),
            })
            .and_then(move |_| {
                if let Some(mut f) = auto_returns2.try_lock() {
                    if let Some(f) = f.take() {
                        return Either::A(f);
                    }
                }
                Either::B(Ok(()).into_future())
            });
        Either::A(a)
    }
}

struct ResponseHandler {
    template_values: TemplateValues,
    precheck_rr_providers: u16,
    outgoing: Arc<Vec<Outgoing>>,
    now: Instant,
    stats_tx: StatsTx,
    endpoint_id: usize,
}

impl ResponseHandler {
    fn handle<F2>(
        self,
        response: hyper::Response<HyperBody>,
        auto_returns: Arc<Mutex<Option<F2>>>,
    ) -> impl Future<Item = (), Error = TestError>
    where
        F2: Future<Item = (), Error = TestError>,
    {
        let status_code = response.status();
        let status = status_code.as_u16();
        let response_provider = json::json!({ "status": status });
        let mut template_values = self.template_values;
        template_values.insert("response".into(), response_provider);
        let mut response_fields_added = 0b000_111;
        handle_response_requirements(
            self.precheck_rr_providers,
            &mut response_fields_added,
            template_values
                .get_mut("response")
                .expect("template_values should have `response`")
                .as_object_mut()
                .expect("`response` in template_values should be an object"),
            &response,
        );
        // executing the where clause determine which of the provides and logs need
        // to be executed
        let included_outgoing_indexes: Result<BTreeSet<_>, _> = self
            .outgoing
            .iter()
            .enumerate()
            .map(|(i, o)| {
                let where_clause_special_providers = o.select.get_where_clause_special_providers();
                if where_clause_special_providers & RESPONSE_BODY == RESPONSE_BODY
                    || where_clause_special_providers & STATS == STATS
                    || o.select.execute_where(template_values.as_json())?
                {
                    handle_response_requirements(
                        o.select.get_special_providers(),
                        &mut response_fields_added,
                        template_values
                            .get_mut("response")
                            .expect("template_values should have `response`")
                            .as_object_mut()
                            .expect("`response` in template_values should be an object"),
                        &response,
                    );
                    Ok(Some(i))
                } else {
                    Ok(None)
                }
            })
            .filter_map(|v| v.transpose())
            .collect();
        let included_outgoing_indexes = match included_outgoing_indexes {
            Ok(v) => v,
            Err(e) => return Either::B(Err(e).into_future()),
        };
        let ce_header = response.headers().get("content-encoding").map(|h| {
            Ok::<_, TestError>(h.to_str().map_err(|_| {
                TestError::Internal(
                    "content-encoding header should be able to be cast to str".into(),
                )
            })?)
        });
        let ce_header = match ce_header {
            Some(Err(e)) => return Either::B(Err(e).into_future()),
            Some(Ok(s)) => s,
            None => "",
        };
        let body_stream = match (
            response_fields_added & RESPONSE_BODY != 0,
            body_reader::Compression::try_from(ce_header),
        ) {
            (true, Some(ce)) => {
                let mut br = body_reader::BodyReader::new(ce);
                let a = response
                    .into_body()
                    .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))
                    .fold(bytes::BytesMut::new(), move |mut out_bytes, chunks| {
                        br.decode(chunks.into_bytes(), &mut out_bytes)
                            .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                        Ok::<_, RecoverableError>(out_bytes)
                    })
                    .and_then(|body| {
                        let s = match str::from_utf8(&body) {
                            Ok(s) => s,
                            Err(e) => {
                                return Either::A(
                                    Err(RecoverableError::BodyErr(Arc::new(e))).into_future(),
                                );
                            }
                        };
                        let value = if let Ok(value) = json::from_str(s) {
                            value
                        } else {
                            json::Value::String(s.into())
                        };
                        Either::B(Ok(Some(value)).into_future())
                    });
                Either::A(a)
            }
            _ => {
                // if we don't need the body, skip parsing it
                Either::B(
                    response
                        .into_body()
                        .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))
                        .for_each(|_| Ok(()))
                        .and_then(|_| Ok(None)),
                )
            }
        };
        let now = self.now;
        let outgoing = self.outgoing;
        let stats_tx = self.stats_tx;
        let endpoint_id = self.endpoint_id;
        let bh = BodyHandler {
            now,
            template_values,
            included_outgoing_indexes,
            outgoing,
            endpoint_id,
            stats_tx,
            status,
        };
        let a = body_stream.then(move |result| bh.handle(result, auto_returns));
        Either::A(a)
    }
}

struct BodyHandler {
    now: Instant,
    template_values: TemplateValues,
    included_outgoing_indexes: BTreeSet<usize>,
    outgoing: Arc<Vec<Outgoing>>,
    endpoint_id: usize,
    stats_tx: StatsTx,
    status: u16,
}

impl BodyHandler {
    fn handle<F2>(
        self,
        result: Result<Option<json::Value>, RecoverableError>,
        auto_returns: Arc<Mutex<Option<F2>>>,
    ) -> impl Future<Item = (), Error = TestError>
    where
        F2: Future<Item = (), Error = TestError>,
    {
        let rtt = self.now.elapsed().as_micros() as u64;
        let stats_tx = self.stats_tx.clone();
        let endpoint_id = self.endpoint_id;
        let send_response_stat = move |kind| {
            Either3::B(
                stats_tx
                    .clone()
                    .send(
                        stats::ResponseStat {
                            endpoint_id,
                            kind,
                            rtt: Some(rtt),
                            time: SystemTime::now(),
                        }
                        .into(),
                    )
                    .map(|_| ())
                    .map_err(|e| {
                        TestError::Internal(
                            format!("unexpected error trying to send stats, {}", e).into(),
                        )
                    }),
            )
        };
        let mut template_values = self.template_values;
        let mut futures = vec![send_response_stat(stats::StatKind::Response(self.status))];
        if let Some(mut f) = auto_returns.try_lock() {
            if let Some(f) = f.take() {
                futures.push(Either3::C(f))
            }
        }
        template_values.insert("stats".into(), json::json!({ "rtt": rtt as f64 / 1000.0 }));
        match result {
            Ok(body) => {
                if let Some(body) = body {
                    template_values
                        .get_mut("response")
                        .expect("template_values should have `response`")
                        .as_object_mut()
                        .expect("`response` in template_values should be an object")
                        .insert("body".into(), body);
                }
                for (i, o) in self.outgoing.iter().enumerate() {
                    if !self.included_outgoing_indexes.contains(&i) {
                        if let Some(cb) = &o.cb {
                            cb();
                        }
                        continue;
                    }
                    let iter = match o.select.as_iter(template_values.as_json().clone()) {
                        Ok(v) => v,
                        Err(TestError::Recoverable(r)) => {
                            let kind = stats::StatKind::RecoverableError(r);
                            futures.push(send_response_stat(kind));
                            continue;
                        }
                        Err(e) => return Either::B(Err(e).into_future()),
                    };
                    match o.select.get_send_behavior() {
                        EndpointProvidesSendOptions::Block => {
                            let tx = o.tx.clone();
                            let cb = o.cb.clone();
                            let fut = stream::iter_result(iter)
                                .map_err(channel::ChannelClosed::wrapped)
                                .forward(tx)
                                .map(|_| ())
                                .or_else(|e| match e.inner_cast::<TestError>() {
                                    Some(e) => Err(*e),
                                    None => Ok(()),
                                })
                                .then(|r| {
                                    if let Some(cb) = cb {
                                        cb()
                                    }
                                    r
                                });
                            futures.push(Either3::A(fut));
                        }
                        EndpointProvidesSendOptions::Force => {
                            for v in iter {
                                let v = match v {
                                    Ok(v) => v,
                                    Err(TestError::Recoverable(r)) => {
                                        let kind = stats::StatKind::RecoverableError(r);
                                        futures.push(send_response_stat(kind));
                                        continue;
                                    }
                                    Err(e) => return Either::B(Err(e).into_future()),
                                };
                                o.tx.force_send(v);
                            }
                            if let Some(cb) = &o.cb {
                                cb();
                            }
                        }
                        EndpointProvidesSendOptions::IfNotFull => {
                            for v in iter {
                                let v = match v {
                                    Ok(v) => v,
                                    Err(TestError::Recoverable(r)) => {
                                        let kind = stats::StatKind::RecoverableError(r);
                                        futures.push(send_response_stat(kind));
                                        continue;
                                    }
                                    Err(e) => return Either::B(Err(e).into_future()),
                                };
                                if !o.tx.try_send(v).is_success() {
                                    break;
                                }
                            }
                            if let Some(cb) = &o.cb {
                                cb();
                            }
                        }
                    }
                }
            }
            Err(r) => {
                let kind = stats::StatKind::RecoverableError(r);
                futures.push(send_response_stat(kind));
            }
        }
        Either::A(join_all(futures).map(|_| ()))
    }
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
