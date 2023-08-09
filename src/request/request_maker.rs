use crate::error::{RecoverableError, TestError};
use crate::stats;

use config::{
    self,
    templating::{Regular, Template, True},
    EndPointBody,
};
use ether::EitherExt;
use futures::{
    future::{self, join_all},
    FutureExt, TryFutureExt,
};
use futures_timer::Delay;
use hyper::{
    client::HttpConnector,
    header::{HeaderMap, HeaderName, HeaderValue, CONTENT_LENGTH, CONTENT_TYPE, HOST},
    Client, Method, Request,
};
use hyper_tls::HttpsConnector;
use log::{debug, info};
use serde_json as json;

use super::{
    body_template_as_hyper_body, response_handler::ResponseHandler, AutoReturn, BlockSender,
    Outgoing, StatsTx, StreamItem, TemplateValues,
};

use std::{
    borrow::Cow,
    collections::BTreeMap,
    error::Error as StdError,
    future::Future,
    sync::Arc,
    task::Poll,
    time::{Duration, Instant, SystemTime},
};

pub(super) struct RequestMaker {
    pub(super) url: Template<String, Regular, True>,
    pub(super) method: Method,
    pub(super) headers: config::common::Headers<True>,
    pub(super) body: Option<EndPointBody>,
    pub(super) client:
        Arc<Client<HttpsConnector<HttpConnector<hyper::client::connect::dns::GaiResolver>>>>,
    pub(super) stats_tx: StatsTx,
    pub(super) no_auto_returns: bool,
    pub(super) outgoing: Arc<Vec<Outgoing>>,
    pub(super) tags: Arc<BTreeMap<Arc<str>, Template<String, Regular, True>>>,
    pub(super) timeout: Duration,
}

pub(super) struct ProviderDelays {
    inner: Vec<Arc<str>>,
}

impl ProviderDelays {
    pub(super) fn new() -> Self {
        Self { inner: Vec::new() }
    }

    fn push(&mut self, name: Arc<str>) {
        self.inner.push(name)
    }

    pub(super) fn log(self, tags: &Arc<BTreeMap<Arc<str>, String>>, stats_tx: &StatsTx) {
        for provider in self.inner {
            let kind = stats::StatKind::RecoverableError(RecoverableError::ProviderDelay(provider));
            let _ = stats_tx.unbounded_send(
                stats::ResponseStat {
                    kind,
                    rtt: None,
                    time: SystemTime::now(),
                    tags: tags.clone(),
                }
                .into(),
            );
        }
    }
}

impl RequestMaker {
    // this function is not async because of a compiler bug which raises a nonsensical error
    // https://github.com/rust-lang/rust/issues/71723
    pub(super) fn send_request(
        &self,
        values: Vec<StreamItem>,
    ) -> impl Future<Output = Result<(), TestError>> {
        let mut template_values = TemplateValues::new();
        let mut auto_returns = Vec::new();
        let mut target_instant = None;
        let mut provider_delays = ProviderDelays::new();
        for tv in values {
            match tv {
                StreamItem::Instant(next_trigger) => {
                    target_instant = next_trigger;
                }
                StreamItem::Declare(name, value, returns, instant) => {
                    match target_instant {
                        Some(target_instant) if instant > target_instant => {
                            provider_delays.push(name.clone());
                        }
                        _ => (),
                    }
                    template_values.insert(name.to_string(), value);
                    auto_returns.extend(returns.into_iter().map(AutoReturn::into_future));
                }
                StreamItem::None => (),
                StreamItem::TemplateValue(name, value, auto_return, instant) => {
                    match target_instant {
                        Some(target_instant) if instant > target_instant => {
                            provider_delays.push(name.clone());
                        }
                        _ => (),
                    }
                    template_values.insert(name.to_string(), value);
                    if let (Some(ar), false) = (auto_return, self.no_auto_returns) {
                        auto_returns.push(ar.into_future());
                    }
                }
            };
        }
        let auto_returns = Some(auto_returns)
            .filter(|ars| !ars.is_empty())
            .map(|ars| join_all(ars).map(|_| ()).shared());
        let url = self
            .url
            .evaluate(Cow::Borrowed(template_values.as_json()) /*, None*/);
        let url = match url {
            Ok(u) => u,
            Err(e) => return future::ready(Err(e.into())).a(),
        };
        let url = match url::Url::parse(&url) {
            Ok(u) => u,
            Err(_) => {
                let e = TestError::InvalidUrl(url);
                return future::ready(Err(e)).a();
            }
        };
        let request = Request::builder()
            .method(self.method.clone())
            .uri(url.as_str());
        let headers = self
            .headers
            .iter()
            .map(|(k, v)| {
                let key = HeaderName::from_bytes(k.as_bytes())
                    .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                let value = HeaderValue::from_str(
                    &v.evaluate(Cow::Borrowed(template_values.as_json()))
                        .expect("TODO"),
                )
                .map_err(|e| RecoverableError::BodyErr(Arc::new(e)))?;
                Ok::<_, TestError>((key, value))
            })
            .collect::<Result<HeaderMap<_>, _>>();
        let mut headers = match headers {
            Ok(h) => h,
            Err(e) => return future::ready(Err(e)).a(),
        };
        let ct_entry = headers.entry(CONTENT_TYPE);
        let mut body_value = None;
        let body =
            body_template_as_hyper_body(&self.body, &template_values, &mut body_value, ct_entry);

        let client = self.client.clone();
        let stats_tx = self.stats_tx.clone();
        let outgoing = self.outgoing.clone();
        let timeout_in_micros = self.timeout.as_micros() as u64;
        let method = self.method.clone();
        let timeout = self.timeout;
        let tags = self.tags.clone();
        let auto_returns2 = auto_returns.clone();

        body.and_then(move |(content_length, body)| {
            let request = request.body(body);
            let mut request = match request {
                Ok(r) => r,
                Err(e) => {
                    let e = TestError::RequestBuilderErr(e.into());
                    return future::ready(Err(e)).a();
                }
            };
            // add the host header
            headers.insert(
                HOST,
                HeaderValue::from_str(url.host_str().expect("should be a valid url"))
                    .expect("url should be a valid string"),
            );
            // add the content-lengh header, if needed
            if content_length > 0 {
                headers.insert(CONTENT_LENGTH, content_length.into());
            }
            debug!("final headers={:?}", headers);
            info!(
                "RequestMaker method=\"{}\" url=\"{}\" request_headers={:?} tags={:?}",
                method,
                url.as_str(),
                headers,
                tags
            );
            let mut request_provider = json::json!({});
            let request_obj = request_provider
                .as_object_mut()
                .expect("should be a json object");

            // add in the url
            let mut protocol: String = url.scheme().into();
            if !protocol.is_empty() {
                protocol = format!("{protocol}:");
            }
            let search_params: json::Map<String, json::Value> = url
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned().into()))
                .collect();
            request_obj.insert(
                "url".into(),
                json::json!({
                    "hash": url.fragment().map(|s| format!("#{s}")).unwrap_or_else(|| "".into()),
                    "host": url.host_str().unwrap_or(""),
                    "hostname": url.domain().unwrap_or(""),
                    "href": url.as_str(),
                    "origin": url.origin().unicode_serialization(),
                    "password": url.password().unwrap_or(""),
                    "pathname": url.path(),
                    "port": url.port().map(|n| n.to_string()).unwrap_or_else(|| "".into()),
                    "protocol": protocol,
                    "search": url.query().map(|s| format!("?{s}")).unwrap_or_else(|| "".into()),
                    "searchParams": search_params,
                    "username": url.username(),
                }),
            );
            // insert request startline
            let url_path_and_query = request
                .uri()
                .path_and_query()
                .map(http::uri::PathAndQuery::as_str)
                .unwrap_or("/");
            let version = request.version();
            request_obj.insert(
                "start-line".into(),
                format!("{method} {url_path_and_query} {version:?}").into(),
            );
            request_obj.insert(
                "start_line".into(),
                format!("{method} {url_path_and_query} {version:?}").into(),
            );
            // insert request headers
            let mut headers_json = json::Map::new();
            for (k, v) in headers.iter() {
                headers_json.insert(
                    k.as_str().to_string(),
                    json::Value::String(String::from_utf8_lossy(v.as_bytes()).into_owned()),
                );
            }
            request_obj.insert("headers".into(), json::Value::Object(headers_json));
            // insert request headers-all
            let mut headers_json = json::Map::new();
            for (k, v) in headers.iter() {
                headers_json
                    .entry(k.as_str())
                    .or_insert_with(|| json::Value::Array(Vec::new()))
                    .as_array_mut()
                    .expect("should be a json array")
                    .push(json::Value::String(
                        String::from_utf8_lossy(v.as_bytes()).into_owned(),
                    ))
            }
            request_obj.insert("headers_all".into(), json::Value::Object(headers_json));
            // insert request body
            let body_string = body_value.unwrap_or_else(|| "".into());
            request_obj.insert("body".into(), body_string.into());
            // insert method
            request_obj.insert("method".into(), method.as_str().into());
            // insert request
            template_values.insert("request".into(), request_provider);
            request.headers_mut().extend(headers);

            // This is the line where the actual request is sent.
            let mut response_future = client.request(request).map_err(|e| {
                let err: Arc<dyn StdError + Send + Sync> = if let Some(io_error_maybe) = e.source()
                {
                    if io_error_maybe.downcast_ref::<std::io::Error>().is_some() {
                        let io_error = e.into_cause().expect("should have a cause error");
                        Arc::new(
                            *io_error
                                .downcast::<std::io::Error>()
                                .expect("should downcast as io error"),
                        )
                    } else {
                        Arc::new(e)
                    }
                } else {
                    Arc::new(e)
                };
                TestError::from(RecoverableError::ConnectionErr(SystemTime::now(), err))
            });
            let outgoing2 = outgoing.clone();
            let mut template_values2 = template_values.clone();
            let stats_tx2 = stats_tx.clone();
            let tags2 = tags.clone();
            let now = Instant::now();

            let mut timeout = Delay::new(timeout);
            future::poll_fn(move |cx| match timeout.poll_unpin(cx) {
                Poll::Ready(_) => Poll::Ready(Err(TestError::from(RecoverableError::Timeout(
                    SystemTime::now(),
                )))),
                Poll::Pending => match response_future.poll_unpin(cx) {
                    Poll::Ready(v) => Poll::Ready(Ok(v)),
                    Poll::Pending => Poll::Pending,
                },
            })
            .and_then(future::ready)
            .and_then(move |response| {
                let rh = ResponseHandler {
                    provider_delays,
                    template_values,
                    outgoing,
                    now,
                    stats_tx,
                    tags,
                };
                rh.handle(response, auto_returns).map_err(TestError::from)
            })
            .or_else(move |r| {
                let r = match r {
                    TestError::Recoverable(r) => r,
                    _ => return future::err(r).a(),
                };
                let tags = tags2
                    .iter()
                    .filter_map(|(k, v)| {
                        v.evaluate(Cow::Borrowed(template_values2.as_json()))
                            .ok()
                            .map(move |v| (Arc::clone(k), v))
                    })
                    .collect();
                let tags = Arc::new(tags);
                let mut futures = Vec::new();
                if outgoing2.iter().any(|o| o.tx.is_logger()) {
                    let error = json::json!({
                        "msg": format!("{r}"),
                        "code": r.code(),
                    });
                    template_values2.insert("error".into(), error);
                    let template_values: Arc<_> = template_values2.0.into();
                    for o in outgoing2.iter() {
                        let query = Arc::clone(&o.query);
                        if let (true, Ok(iter)) =
                            (o.tx.is_logger(), query.query(Arc::clone(&template_values)))
                        {
                            let iter = iter.map(|v| v.map_err(Box::new).map_err(Into::into));
                            let tx = o.tx.clone();
                            futures.push(BlockSender::new(iter, tx).into_future());
                        }
                    }
                }
                let time = match r {
                    RecoverableError::Timeout(t) | RecoverableError::ConnectionErr(t, _) => t,
                    _ => SystemTime::now(),
                };
                let rtt = match r {
                    RecoverableError::Timeout(_) => Some(timeout_in_micros),
                    _ => None,
                };
                let _ = stats_tx2.unbounded_send(
                    stats::ResponseStat {
                        kind: stats::StatKind::RecoverableError(r),
                        rtt,
                        time,
                        tags,
                    }
                    .into(),
                );
                join_all(futures).map(|_| Ok(())).b()
            })
            .b()
        })
        .then(move |_| {
            auto_returns2.map_or_else(|| future::ready(Ok(())).b(), |f| f.map(|_| Ok(())).a())
        })
        .b()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create_http_client;
    use config::common::Headers;
    use futures::channel::mpsc as futures_channel;
    use tokio::runtime::Runtime;

    #[test]
    fn sends_request() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async move {
            let (port, ..) = test_common::start_test_server(None);
            let url = Template::new_literal(format!("https://127.0.0.1:{}", port));
            let method = Method::GET;
            let headers = Headers::new();
            let body = None;
            let client = create_http_client(Duration::from_secs(60)).unwrap().into();
            let (stats_tx, _) = futures_channel::unbounded();
            let no_auto_returns = true;
            let outgoing = Vec::new().into();
            let timeout = Duration::from_secs(120);
            let tags = Arc::new(BTreeMap::new());

            let rm = RequestMaker {
                url,
                method,
                headers,
                body,
                client,
                stats_tx,
                no_auto_returns,
                outgoing,
                tags,
                timeout,
            };

            let r = rm.send_request(Vec::new()).await;
            assert!(r.is_ok());
        });
    }
}
