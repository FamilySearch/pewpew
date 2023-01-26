#![allow(clippy::type_complexity)]
mod body_handler;
mod request_maker;
mod response_handler;

use self::body_handler::BodyHandler;
use self::request_maker::RequestMaker;

use log::debug;
use request_maker::ProviderDelays;

use bytes::Bytes;
use ether::{Either, Either3, EitherExt};
use for_each_parallel::ForEachParallel;
use futures::{
    channel::mpsc as futures_channel,
    future::{self, try_join_all},
    sink::SinkExt,
    stream, FutureExt, Stream, StreamExt, TryFutureExt, TryStreamExt,
};
use hyper::{
    client::HttpConnector,
    header::{Entry as HeaderEntry, HeaderName, HeaderValue, CONTENT_DISPOSITION},
    Body as HyperBody, Client, Method, Response,
};
use hyper_tls::HttpsConnector;
use rand::distributions::{Alphanumeric, Distribution};
use select_any::select_any;
use serde_json as json;
use tokio::{
    fs::File as TokioFile,
    io::{AsyncRead, ReadBuf},
};
use zip_all::zip_all;

use crate::error::{RecoverableError, TestError};
use crate::providers;
use crate::stats;
use crate::util::tweak_path;
use config::{
    BodyTemplate, EndpointProvidesSendOptions, MultipartBody, ProviderStream, Select, Template,
};

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    future::Future,
    num::NonZeroUsize,
    ops::{Deref, DerefMut},
    path::PathBuf,
    pin::Pin,
    str,
    sync::Arc,
    task::{Context, Poll},
    time::{Duration, Instant},
};

#[derive(Clone)]
pub struct AutoReturn {
    send_option: EndpointProvidesSendOptions,
    channel: channel::Sender<json::Value>,
    jsons: Vec<json::Value>,
}

impl AutoReturn {
    pub fn new(
        send_option: EndpointProvidesSendOptions,
        channel: channel::Sender<json::Value>,
        jsons: Vec<json::Value>,
    ) -> Self {
        AutoReturn {
            send_option,
            channel,
            jsons,
        }
    }

    pub async fn into_future(mut self) {
        debug!("AutoReturn::into_future.send_option={:?}", self.send_option);
        match self.send_option {
            EndpointProvidesSendOptions::Block => {
                let _ = self
                    .channel
                    .send_all(&mut stream::iter(self.jsons).map(Ok))
                    .await;
            }
            EndpointProvidesSendOptions::Force => {
                while let Some(json) = self.jsons.pop() {
                    log::trace!("AutoReturn::into_future::Force json={}", json);
                    self.channel.force_send(json);
                }
            }
            EndpointProvidesSendOptions::IfNotFull => {
                while let Some(json) = self.jsons.pop() {
                    log::trace!("AutoReturn::into_future::IfNotFull json={}", json);
                    if self.channel.send(json).now_or_never().is_none() {
                        break;
                    }
                }
            }
        };
    }
}

#[derive(Clone, Debug)]
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

#[derive(Clone)]
enum ProviderOrLogger {
    Provider(channel::Sender<json::Value>),
    Logger(providers::Logger),
}

impl ProviderOrLogger {
    fn is_logger(&self) -> bool {
        match &self {
            Self::Provider(_) => false,
            Self::Logger(_) => true,
        }
    }

    fn name(&self) -> String {
        match &self {
            Self::Provider(provider) => format!("Provider: {}", provider.name()),
            Self::Logger(logger) => format!("Logger: {logger:?}"),
        }
    }
}

struct Outgoing {
    select: Arc<Select>,
    tx: ProviderOrLogger,
}

impl Outgoing {
    fn new(select: Select, tx: ProviderOrLogger) -> Self {
        Outgoing {
            select: select.into(),
            tx,
        }
    }
}

type ProviderStreamStream<Ar> = Box<
    dyn Stream<Item = Result<(json::Value, Vec<Ar>), config::ExecutingExpressionError>>
        + Send
        + Unpin
        + 'static,
>;

impl ProviderStream<AutoReturn> for providers::Provider {
    fn into_stream(&self) -> ProviderStreamStream<AutoReturn> {
        let auto_return = self.auto_return.map(|ar| (ar, self.tx.clone()));
        let future = self.rx.clone().map(move |v| {
            let mut outgoing = Vec::new();
            if let Some((ar, tx)) = &auto_return {
                outgoing.push(AutoReturn::new(*ar, tx.clone(), vec![v.clone()]));
            };
            Ok((v, outgoing))
        });
        Box::new(future)
    }
}

pub struct BuilderContext {
    pub config: config::Config,
    pub config_path: PathBuf,
    // the http client
    pub client:
        Arc<Client<HttpsConnector<HttpConnector<hyper::client::connect::dns::GaiResolver>>>>,
    // a mapping of names to their prospective providers
    pub providers: Arc<BTreeMap<String, providers::Provider>>,
    // a mapping of names to their prospective loggers
    pub loggers: BTreeMap<String, providers::Logger>,
    // channel that receives and aggregates stats for the test
    pub stats_tx: StatsTx,
}

pub struct EndpointBuilder {
    endpoint: config::Endpoint,
    start_stream: Option<Pin<Box<dyn Stream<Item = (Instant, Option<Instant>)> + Send>>>,
}

fn convert_to_debug<T>(value: &[(String, T)]) -> Vec<String> {
    value.iter().map(|(key, _)| key.to_string()).collect()
}

impl EndpointBuilder {
    pub fn new(
        endpoint: config::Endpoint,
        start_stream: Option<Pin<Box<dyn Stream<Item = (Instant, Option<Instant>)> + Send>>>,
    ) -> Self {
        EndpointBuilder {
            endpoint,
            start_stream,
        }
    }

    pub fn build(self, ctx: &mut BuilderContext) -> Endpoint {
        let mut outgoing = Vec::new();
        let mut on_demand_streams: OnDemandStreams = Vec::new();

        let config::Endpoint {
            method,
            headers,
            body,
            no_auto_returns,
            providers_to_stream,
            url,
            max_parallel_requests,
            provides,
            logs,
            on_demand,
            tags,
            request_timeout,
            ..
        } = self.endpoint;
        debug!("EndpointBuilder.build method=\"{}\" url=\"{}\" body=\"{}\" headers=\"{:?}\" no_auto_returns=\"{}\" \
            max_parallel_requests=\"{:?}\" provides=\"{:?}\" logs=\"{:?}\" on_demand=\"{}\" request_timeout=\"{:?}\"",
            method.as_str(), url.evaluate_with_star(), body, convert_to_debug(&headers), no_auto_returns,
            max_parallel_requests, convert_to_debug(&provides), convert_to_debug(&logs), on_demand, request_timeout);

        let timeout = request_timeout.unwrap_or(ctx.config.client.request_timeout);

        let mut provides_set = if self.start_stream.is_none() && !provides.is_empty() {
            Some(BTreeSet::new())
        } else {
            None
        };
        // Build the actual provider set "outgoing"
        let provides = provides
            .into_iter()
            .map(|(k, v)| {
                debug!("EndpointBuilder.build provide method=\"{}\" url=\"{}\" provide=\"{:?}\" provides=\"{:?}\"",
                    method.as_str(), url.evaluate_with_star(), k, v);
                let provider = ctx
                    .providers
                    .get(&k)
                    .expect("provides should reference a provider");
                let tx = provider.tx.clone();
                if let Some(set) = &mut provides_set {
                    set.insert(tx.clone());
                }
                if on_demand {
                    let stream = provider.on_demand.clone();
                    on_demand_streams.push(Box::new(stream));
                }
                Outgoing::new(v, ProviderOrLogger::Provider(tx))
            })
            .collect();

        let mut streams: StreamCollection = Vec::new();
        if let Some(start_stream) = self.start_stream {
            streams.push((
                true,
                Box::new(start_stream.map(|(_, d)| Ok(StreamItem::Instant(d)))),
            ));
        } else if let Some(set) = provides_set {
            let stream = stream::poll_fn(move |_| {
                let done = set.iter().all(channel::Sender::no_receivers);
                if done {
                    Poll::Ready(None)
                } else {
                    Poll::Ready(Some(Ok(StreamItem::None)))
                }
            });
            streams.push((true, Box::new(stream)));
        }
        // Add any loggers to the outgoing providers/loggers
        for (k, v) in logs {
            debug!(
                "EndpointBuilder.build logs key=\"{}\" Select=\"{:?}\"",
                k, v
            );
            let tx = ctx
                .loggers
                .get(&k)
                .expect("logs should reference a valid logger");
            outgoing.push(Outgoing::new(v, ProviderOrLogger::Logger(tx.clone())));
        }
        // Required providers
        // these u16s are bitwise maps of what standard select request/response/stats are selected
        let rr_providers = providers_to_stream.get_special();
        let precheck_rr_providers = providers_to_stream.get_where_special();
        // go through the list of required providers and make sure we have them all
        for name in providers_to_stream.unique_providers() {
            let provider = match ctx.providers.get(&name) {
                Some(p) => p,
                None => continue,
            };
            debug!("EndpointBuilder.build unique_providers name=\"{}\"", name);
            let receiver = provider.rx.clone();
            let ar = provider
                .auto_return
                .map(|send_option| (send_option, provider.tx.clone()));
            let provider_stream = Box::new(receiver.map(move |v| {
                let ar = if no_auto_returns {
                    None
                } else {
                    ar.clone()
                        .map(|(send_option, tx)| AutoReturn::new(send_option, tx, vec![v.clone()]))
                };
                Ok(StreamItem::TemplateValue(
                    name.clone(),
                    v,
                    ar,
                    Instant::now(),
                ))
            }));
            streams.push((false, provider_stream));
        }

        for (name, vce) in self.endpoint.declare {
            debug!(
                "EndpointBuilder.build declare name=\"{}\" valueOrExpression=\"{:?}\"",
                name, vce
            );
            let stream = vce
                .into_stream(&ctx.providers, false)
                .map_ok(move |(v, returns)| {
                    StreamItem::Declare(name.clone(), v, returns, Instant::now())
                })
                .map_err(Into::into);
            streams.push((false, Box::new(stream)));
        }
        let stats_tx = ctx.stats_tx.clone();
        let client = ctx.client.clone();
        Endpoint {
            body,
            client,
            headers,
            max_parallel_requests,
            method,
            no_auto_returns,
            on_demand_streams,
            outgoing, // loggers
            precheck_rr_providers,
            provides, // providers
            rr_providers,
            tags: Arc::new(tags),
            stats_tx,
            stream_collection: streams,
            url,
            timeout,
        }
    }
}

pub enum StreamItem {
    Instant(Option<Instant>),
    Declare(String, json::Value, Vec<AutoReturn>, Instant),
    None,
    TemplateValue(String, json::Value, Option<AutoReturn>, Instant),
}

fn multipart_body_as_hyper_body(
    multipart_body: &MultipartBody,
    template_values: &TemplateValues,
    content_type_entry: HeaderEntry<'_, HeaderValue>,
    copy_body_value: bool,
    body_value: &mut Option<String>,
) -> Result<impl Future<Output = Result<(u64, HyperBody), TestError>>, TestError> {
    let boundary: String = Alphanumeric
        .sample_iter(&mut rand::thread_rng())
        .map(char::from)
        .take(20)
        .collect();

    let is_form = {
        let content_type =
            content_type_entry.or_insert_with(|| HeaderValue::from_static("multipart/form-data"));
        let ct_str = content_type
            .to_str()
            .map_err::<TestError, _>(|e| RecoverableError::BodyErr(Arc::new(e)).into())?;

        if ct_str.starts_with("multipart/") {
            let is_form = ct_str.starts_with("multipart/form-data");
            *content_type =
                HeaderValue::from_str(&format!("{ct_str};boundary={boundary}"))
                    .map_err::<TestError, _>(|e| RecoverableError::BodyErr(Arc::new(e)).into())?;
            is_form
        } else {
            *content_type =
                HeaderValue::from_str(&format!("multipart/form-data;boundary={boundary}"))
                    .map_err::<TestError, _>(|e| RecoverableError::BodyErr(Arc::new(e)).into())?;
            true
        }
    };

    let mut closing_boundary = Vec::new();
    closing_boundary.extend_from_slice(b"\r\n--");
    closing_boundary.extend_from_slice(boundary.as_bytes());
    closing_boundary.extend_from_slice(b"--\r\n");

    let mut body_value2 = Vec::new();

    let pieces = multipart_body
        .pieces
        .iter()
        .enumerate()
        .map(|(i, mp)| {
            let mut body = mp
                .template
                .evaluate(Cow::Borrowed(template_values.as_json()), None)
                .map_err(TestError::from)?;

            let mut has_content_disposition = false;

            let mut piece_data = Vec::new();
            if i == 0 {
                piece_data.extend_from_slice(b"--");
            } else {
                piece_data.extend_from_slice(b"\r\n--");
            }
            piece_data.extend_from_slice(boundary.as_bytes());

            for (k, t) in mp.headers.iter() {
                let key = HeaderName::from_bytes(k.as_bytes())
                    .map_err::<TestError, _>(|e| RecoverableError::BodyErr(Arc::new(e)).into())?;
                let value = t
                    .evaluate(Cow::Borrowed(template_values.as_json()), None)
                    .map_err::<TestError, _>(Into::into)?;
                let value = HeaderValue::from_str(&value)
                    .map_err::<TestError, _>(|e| RecoverableError::BodyErr(Arc::new(e)).into())?;

                let content_disposition = CONTENT_DISPOSITION;
                has_content_disposition |= key == content_disposition;

                piece_data.extend_from_slice(b"\r\n");
                piece_data.extend_from_slice(key.as_ref());
                piece_data.extend_from_slice(b": ");
                piece_data.extend_from_slice(value.as_bytes());
            }

            if is_form && !has_content_disposition {
                let value = if mp.is_file {
                    HeaderValue::from_str(&format!(
                        "form-data; name=\"{}\"; filename=\"{}\"",
                        mp.name, body
                    ))
                } else {
                    HeaderValue::from_str(&format!("form-data; name=\"{}\"", mp.name))
                };
                let value = value
                    .map_err::<TestError, _>(|e| RecoverableError::BodyErr(Arc::new(e)).into())?;

                piece_data.extend_from_slice(b"\r\ncontent-disposition: ");
                piece_data.extend_from_slice(value.as_bytes());
            }

            piece_data.extend_from_slice(b"\r\n\r\n");

            let ret = if mp.is_file {
                if copy_body_value {
                    body_value2.extend_from_slice(&piece_data);
                    body_value2.extend_from_slice(b"<<contents of file: ");
                    body_value2.extend_from_slice(body.as_bytes());
                    body_value2.extend_from_slice(b">>");
                }
                let piece_data_bytes = piece_data.len() as u64;
                let piece_stream = future::ok(Bytes::from(piece_data)).into_stream();
                tweak_path(&mut body, &multipart_body.path);
                let a = create_file_hyper_body(body).map_ok(move |(bytes, body)| {
                    let stream = piece_stream.chain(body).a();
                    (bytes + piece_data_bytes, stream)
                });
                Either::A(a)
            } else {
                piece_data.extend_from_slice(body.as_bytes());
                if copy_body_value {
                    body_value2.extend_from_slice(&piece_data);
                }
                let piece_data_bytes = piece_data.len() as u64;
                let piece_stream = future::ok(Bytes::from(piece_data)).into_stream().b();
                let b = future::ok((piece_data_bytes, piece_stream));
                Either::B(b)
            };
            Ok::<_, TestError>(ret)
        })
        .collect::<Result<Vec<_>, _>>()?;

    if copy_body_value {
        body_value2.extend_from_slice(&closing_boundary);
        let bv = match String::from_utf8(body_value2) {
            Ok(bv) => bv,
            Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
        };
        *body_value = Some(bv);
    }

    let ret = try_join_all(pieces).map_ok(move |results| {
        let mut bytes = closing_boundary.len() as u64;
        let mut bodies = Vec::new();
        for (bytes2, body) in results {
            bodies.push(body);
            bytes += bytes2;
        }

        let closing_boundary = Bytes::from(closing_boundary);

        let stream = stream::iter(bodies)
            .flatten()
            .chain(stream::once(future::ok(closing_boundary)));

        (bytes, HyperBody::wrap_stream(stream))
    });
    Ok(ret)
}

async fn create_file_hyper_body(filename: String) -> Result<(u64, HyperBody), TestError> {
    let mut file = match TokioFile::open(&filename).await {
        Ok(f) => f,
        Err(e) => return Err(TestError::FileReading(filename, e.into())),
    };
    let bytes = match file.metadata().await {
        Ok(m) => m.len(),
        Err(e) => return Err(TestError::FileReading(filename, e.into())),
    };

    let stream = stream::poll_fn(move |cx| {
        let mut buffer = vec![0; 8192];
        let mut buf = ReadBuf::new(&mut buffer);
        match Pin::new(&mut file).poll_read(cx, &mut buf) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Err(e)) => Poll::Ready(Some(Err(e))),
            Poll::Ready(Ok(_)) if buf.filled().is_empty() => Poll::Ready(None),
            Poll::Ready(Ok(_)) => {
                let len = buf.filled().len();
                buffer.truncate(len);
                Poll::Ready(Some(Ok(buffer)))
            }
        }
    });

    let body = HyperBody::wrap_stream(stream);
    Ok((bytes, body))
}

fn body_template_as_hyper_body(
    body_template: &BodyTemplate,
    template_values: &TemplateValues,
    copy_body_value: bool,
    body_value: &mut Option<String>,
    content_type_entry: HeaderEntry<'_, HeaderValue>,
) -> impl Future<Output = Result<(u64, HyperBody), TestError>> {
    let template = match body_template {
        BodyTemplate::File(_, t) => t,
        BodyTemplate::Multipart(m) => {
            let r = multipart_body_as_hyper_body(
                m,
                template_values,
                content_type_entry,
                copy_body_value,
                body_value,
            );
            return Either3::A(future::ready(r).and_then(|x| x));
        }
        BodyTemplate::None => return Either3::B(future::ok((0, HyperBody::empty()))),
        BodyTemplate::String(t) => t,
    };
    let mut body = match template.evaluate(Cow::Borrowed(template_values.as_json()), None) {
        Ok(b) => b,
        Err(e) => return Either3::B(future::err(TestError::from(e))),
    };
    if let BodyTemplate::File(path, _) = body_template {
        tweak_path(&mut body, path);
        if copy_body_value {
            *body_value = Some(format!("<<contents of file: {body}>>"));
        }
        Either3::C(create_file_hyper_body(body))
    } else {
        if copy_body_value {
            *body_value = Some(body.clone());
        }
        Either3::B(future::ok((body.as_bytes().len() as u64, body.into())))
    }
}

type StreamCollection = Vec<(
    bool,
    Box<dyn Stream<Item = Result<StreamItem, TestError>> + Send + Unpin + 'static>,
)>;
type OnDemandStreams = Vec<Box<dyn Stream<Item = ()> + Send + Unpin + 'static>>;
pub type StatsTx = futures_channel::UnboundedSender<stats::StatsMessage>;

pub struct Endpoint {
    body: BodyTemplate,
    client: Arc<Client<HttpsConnector<HttpConnector<hyper::client::connect::dns::GaiResolver>>>>,
    headers: Vec<(String, Template)>,
    max_parallel_requests: Option<NonZeroUsize>,
    method: Method,
    no_auto_returns: bool,
    on_demand_streams: OnDemandStreams,
    outgoing: Vec<Outgoing>,
    precheck_rr_providers: u16,
    provides: Vec<Outgoing>,
    rr_providers: u16,
    tags: Arc<BTreeMap<String, Template>>,
    stats_tx: StatsTx,
    stream_collection: StreamCollection,
    timeout: Duration,
    url: Template,
}

impl Endpoint {
    pub fn clear_provides(&mut self) {
        self.provides.clear();
    }

    pub fn add_start_stream<S>(&mut self, stream: S)
    where
        S: Stream<Item = Result<StreamItem, TestError>> + Send + Unpin + 'static,
    {
        let stream = Box::new(stream);
        // If we have one, replace it, otherwise add (set as 0) it
        match self.stream_collection.get_mut(0) {
            Some((true, s)) => {
                *s = stream;
            }
            _ => self.stream_collection.push((true, stream)),
        }
    }

    // This returns a boxed future because otherwise the type system runs out of memory for the type
    pub fn into_future(self) -> Box<dyn Future<Output = Result<(), TestError>> + Send + Unpin> {
        let url = self.url;
        let method = self.method;
        let headers = self.headers;
        let body = self.body;
        let rr_providers = self.rr_providers;
        let client = self.client;
        let stats_tx = self.stats_tx;
        let no_auto_returns = self.no_auto_returns;
        let streams = self.stream_collection.into_iter().map(|t| t.1);
        let mut zipped_streams = zip_all(streams);
        let stream = if !self.on_demand_streams.is_empty() && !self.provides.is_empty() {
            let mut on_demand_streams = select_any(self.on_demand_streams);
            let mut od_continue = false;
            stream::poll_fn(move |cx| {
                let p = on_demand_streams.poll_next_unpin(cx);
                if !od_continue {
                    match p {
                        Poll::Ready(Some(_)) => od_continue = true,
                        Poll::Ready(None) => return Poll::Ready(None),
                        Poll::Pending => return Poll::Pending,
                    }
                }
                let p = zipped_streams.poll_next_unpin(cx);
                if p.is_ready() {
                    od_continue = false;
                }
                p
            })
            .a()
        } else {
            zipped_streams.b()
        };
        let mut outgoing = self.outgoing;
        outgoing.extend(self.provides);
        let outgoing = Arc::new(outgoing);
        let precheck_rr_providers = self.precheck_rr_providers;
        let timeout = self.timeout;
        let max_parallel_requests = self.max_parallel_requests;
        let tags = self.tags;
        let blocking_outgoing: Vec<_> = outgoing
            .iter()
            .filter_map(|o| match (&o.tx, o.select.get_send_behavior().is_block()) {
                (ProviderOrLogger::Provider(tx), true) => Some(tx.clone()),
                _ => None,
            })
            .collect();
        debug!(
            "into_future method=\"{}\" url=\"{:?}\" request_headers={:?} tags={:?}",
            method, url, headers, tags
        );
        let rm = RequestMaker {
            url,
            method,
            headers,
            body,
            rr_providers,
            client,
            stats_tx,
            no_auto_returns,
            outgoing,
            precheck_rr_providers,
            tags,
            timeout,
        };
        let limit_fn: Option<Box<dyn FnMut(usize) -> usize + Send + Unpin>> =
            match (blocking_outgoing.is_empty(), max_parallel_requests) {
                (false, Some(n)) => {
                    let mut multiplier: u8 = 1;
                    let mut all_full_count: u8 = 0;
                    let limit_fn = move |in_progress| {
                        let (empty_slots, has_empty, all_full) = blocking_outgoing.iter().fold(
                            (0usize, false, true),
                            |(empty_slots, has_empty, all_full), tx| {
                                let count = tx.len();
                                let limit = tx.limit();
                                (
                                    empty_slots.max(limit.saturating_sub(count)),
                                    has_empty || count == 0,
                                    all_full && count == limit,
                                )
                            },
                        );
                        if all_full {
                            if all_full_count < multiplier {
                                all_full_count += 1;
                            }
                        } else {
                            all_full_count = 0;
                        }
                        // if any of the block providers this endpoint provides are empty
                        // and the number of empty slots * multiplier is equal to the number
                        // of in_progress requests increment the multiplier
                        // or if all the providers are full and have been full for the same
                        // number of times as the multiplier decrement the multiiplier
                        // while keeping the multiplier between 1 and 10 inclusive
                        if has_empty
                            && multiplier < 10
                            && in_progress == empty_slots * multiplier as usize
                        {
                            multiplier += 1;
                        } else if all_full_count == multiplier && multiplier > 1 {
                            multiplier -= 1;
                            all_full_count = 0;
                        }
                        n.get().min(empty_slots.max(1) * multiplier as usize)
                    };
                    Some(Box::new(limit_fn))
                }
                (false, None) => {
                    let mut multiplier: u8 = 1;
                    let mut all_full_count: u8 = 0;
                    let limit_fn = move |in_progress| {
                        let (empty_slots, has_empty, all_full) = blocking_outgoing.iter().fold(
                            (0usize, false, true),
                            |(empty_slots, has_empty, all_full), tx| {
                                let count = tx.len();
                                let limit = tx.limit();
                                (
                                    empty_slots.max(limit.saturating_sub(count)),
                                    has_empty || count == 0,
                                    all_full && count == limit,
                                )
                            },
                        );
                        if all_full {
                            if all_full_count < multiplier {
                                all_full_count += 1;
                            }
                        } else {
                            all_full_count = 0;
                        }
                        // if any of the block providers this endpoint provides are empty
                        // and the number of empty slots * multiplier is equal to the number
                        // of in_progress requests increment the multiplier
                        // or if all the providers are full and have been full for the same
                        // number of times as the multiplier decrement the multiiplier
                        // while keeping the multiplier between 1 and 10 inclusive
                        if has_empty
                            && multiplier < 10
                            && in_progress == empty_slots * multiplier as usize
                        {
                            multiplier += 1;
                        } else if all_full_count == multiplier && multiplier > 1 {
                            multiplier -= 1;
                            all_full_count = 0;
                        }
                        empty_slots.max(1) * multiplier as usize
                    };
                    Some(Box::new(limit_fn))
                }
                (true, Some(n)) => Some(Box::new(move |_| n.get())),
                (true, None) => None,
            };
        let f = ForEachParallel::new(limit_fn, stream, move |values| rm.send_request(values));
        Box::new(f)
    }
}

struct BlockSender<V: Iterator<Item = Result<json::Value, RecoverableError>> + Unpin> {
    tx: ProviderOrLogger,
    values: V,
    value_added: bool,
    next_value: Option<json::Value>,
}

impl<V: Iterator<Item = Result<json::Value, RecoverableError>> + Unpin> BlockSender<V> {
    fn new(values: V, tx: ProviderOrLogger) -> Self {
        BlockSender {
            tx,
            values,
            value_added: false,
            next_value: None,
        }
    }
}

impl<V: Iterator<Item = Result<json::Value, RecoverableError>> + Unpin> Future for BlockSender<V> {
    type Output = Result<(), RecoverableError>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        loop {
            // Check if there's a self.next_value
            let value_to_add = match self.next_value.take() {
                Some(next_value) => next_value,
                // Check the values list if there isn't one already in self.next_value
                None => match self.values.next() {
                    Some(Ok(v)) => v, // Got a value from self.values
                    Some(Err(e)) => return Poll::Ready(Err(e)),
                    None => break, // self.values is empty
                },
            };
            // We've got a value. Check the tx status
            match &mut self.tx {
                ProviderOrLogger::Logger(tx) => match tx.poll_ready_unpin(cx) {
                    Poll::Ready(Ok(())) => {
                        if tx.start_send_unpin(value_to_add).is_err() {
                            break;
                        }
                        self.value_added = true;
                    }
                    Poll::Pending => {
                        // tx not ready, put it (back) in next_value
                        self.next_value = Some(value_to_add);
                        return Poll::Pending;
                    }
                    Poll::Ready(Err(_)) => break,
                },
                ProviderOrLogger::Provider(tx) => match tx.poll_ready_unpin(cx) {
                    Poll::Ready(Ok(())) => {
                        if tx.start_send_unpin(value_to_add).is_err() {
                            break;
                        }
                        self.value_added = true;
                    }
                    Poll::Pending => {
                        // tx not ready, put it (back) in next_value
                        self.next_value = Some(value_to_add);
                        return Poll::Pending;
                    }
                    Poll::Ready(Err(_)) => break,
                },
            }
        }
        if self.value_added {
            match &mut self.tx {
                ProviderOrLogger::Logger(tx) => {
                    if tx.poll_flush_unpin(cx).is_pending() {
                        return Poll::Pending;
                    }
                }
                ProviderOrLogger::Provider(tx) => {
                    if tx.poll_flush_unpin(cx).is_pending() {
                        return Poll::Pending;
                    }
                }
            }
        }
        Poll::Ready(Ok(()))
    }
}

impl<V: Iterator<Item = Result<json::Value, RecoverableError>> + Unpin> Drop for BlockSender<V> {
    fn drop(&mut self) {
        self.now_or_never();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stream::StreamExt;
    use tokio::runtime::Runtime;

    #[test]
    fn file_bodies_work() {
        let f = async {
            let (_, body) = create_file_hyper_body("tests/test.jpg".to_string())
                .await
                .unwrap();
            body.map(|b| stream::iter(b.unwrap()))
                .flatten()
                .collect::<Vec<_>>()
                .await
        };
        let rt = Runtime::new().unwrap();
        let streamed_bytes = rt.block_on(f);
        let file_bytes = include_bytes!("../tests/test.jpg").to_vec();
        assert_eq!(file_bytes, streamed_bytes);
    }
}
