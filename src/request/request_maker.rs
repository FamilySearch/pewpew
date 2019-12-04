use crate::error::{RecoverableError, TestError};
use crate::stats;

use config::{
    BodyTemplate, Template, REQUEST_BODY, REQUEST_HEADERS, REQUEST_STARTLINE, REQUEST_URL,
};
use ether::{Either, Either3};
use futures::future::{join_all, Future, IntoFuture};
use hyper::{
    client::HttpConnector,
    header::{HeaderMap, HeaderName, HeaderValue, CONTENT_LENGTH, CONTENT_TYPE, HOST},
    Client, Method, Request,
};
use hyper_tls::HttpsConnector;
use parking_lot::Mutex;
use serde_json as json;
use tokio::timer::Timeout;

use super::{
    body_template_as_hyper_body, response_handler::ResponseHandler, AutoReturn, BlockSender,
    Outgoing, StatsTx, StreamItem, TemplateValues,
};

use std::{
    borrow::Cow,
    collections::BTreeMap,
    error::Error as StdError,
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

pub(super) struct RequestMaker {
    pub(super) url: Template,
    pub(super) method: Method,
    pub(super) headers: Vec<(String, Template)>,
    pub(super) body: BodyTemplate,
    pub(super) rr_providers: u16,
    pub(super) client: Arc<
        Client<
            HttpsConnector<HttpConnector<hyper::client::connect::dns::TokioThreadpoolGaiResolver>>,
        >,
    >,
    pub(super) stats_tx: StatsTx,
    pub(super) no_auto_returns: bool,
    pub(super) outgoing: Arc<Vec<Outgoing>>,
    pub(super) precheck_rr_providers: u16,
    pub(super) tags: Arc<BTreeMap<String, Template>>,
    pub(super) timeout: Duration,
}

pub(super) struct ProviderDelays {
    inner: Vec<String>,
}

impl ProviderDelays {
    pub(super) fn new() -> Self {
        ProviderDelays { inner: Vec::new() }
    }

    fn push(&mut self, name: String) {
        self.inner.push(name)
    }

    pub(super) fn log(self, tags: &Arc<BTreeMap<String, String>>, stats_tx: &StatsTx) {
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
    pub(super) fn send_request(
        &self,
        values: Vec<StreamItem>,
    ) -> impl Future<Item = (), Error = TestError> {
        let mut template_values = TemplateValues::new();
        let mut auto_returns = Vec::new();
        let mut target_instant = None;
        let mut provider_delays = ProviderDelays::new();
        for tv in values {
            match tv {
                StreamItem::Instant(i) => target_instant = Some(i),
                StreamItem::Declare(name, value, returns, instant) => {
                    match target_instant {
                        Some(target_instant) if instant > target_instant => {
                            provider_delays.push(name.clone());
                        }
                        _ => (),
                    }
                    template_values.insert(name, value);
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
                    template_values.insert(name, value);
                    if let (Some(ar), false) = (auto_return, self.no_auto_returns) {
                        auto_returns.push(ar.into_future());
                    }
                }
            };
        }
        let auto_returns: Arc<_> =
            Mutex::new(Some(join_all(auto_returns).map(|_| ()).map_err(|_| {
                unreachable!("auto returns should never error");
            })))
            .into();
        let mut request = Request::builder();
        let url = match self
            .url
            .evaluate(Cow::Borrowed(template_values.as_json()), None)
        {
            Ok(u) => u,
            Err(e) => return Either::B(Err(TestError::from(e)).into_future()),
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
                let value = HeaderValue::from_str(
                    &v.evaluate(Cow::Borrowed(template_values.as_json()), None)?,
                )
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
        let body = body_template_as_hyper_body(
            &self.body,
            &template_values,
            self.rr_providers & REQUEST_BODY != 0,
            &mut body_value,
            ct_entry,
        );

        let client = self.client.clone();
        let stats_tx = self.stats_tx.clone();
        let outgoing = self.outgoing.clone();
        let timeout_in_micros = self.timeout.as_micros() as u64;
        let precheck_rr_providers = self.precheck_rr_providers;
        let rr_providers = self.rr_providers;
        let method = self.method.clone();
        let timeout = self.timeout;
        let tags = self.tags.clone();

        let a = body.and_then(move |(content_length, body)| {
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
            if content_length > 0 {
                headers.insert(CONTENT_LENGTH, content_length.into());
            }
            let mut request_provider = json::json!({});
            let request_obj = request_provider
                .as_object_mut()
                .expect("should be a json object");
            if rr_providers & REQUEST_URL == REQUEST_URL {
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
            if rr_providers & REQUEST_STARTLINE != 0 {
                let url_path_and_query = request
                    .uri()
                    .path_and_query()
                    .map(http::uri::PathAndQuery::as_str)
                    .unwrap_or("/");
                let version = request.version();
                request_obj.insert(
                    "start-line".into(),
                    format!("{} {} {:?}", method, url_path_and_query, version).into(),
                );
            }
            if rr_providers & REQUEST_HEADERS != 0 {
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
            if rr_providers & REQUEST_BODY != 0 {
                let body_string = body_value.unwrap_or_else(|| "".into());
                request_obj.insert("body".into(), body_string.into());
            }
            request_obj.insert("method".into(), method.as_str().into());
            template_values.insert("request".into(), request_provider);
            request.headers_mut().extend(headers);

            let response_future = client.request(request);
            let now = Instant::now();
            let outgoing2 = outgoing.clone();
            let auto_returns2 = auto_returns.clone();

            let a = Timeout::new(response_future, timeout)
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
                .then(move |result| match result {
                    Ok(response) => {
                        let rh = ResponseHandler {
                            provider_delays,
                            template_values,
                            precheck_rr_providers,
                            rr_providers,
                            outgoing,
                            now,
                            stats_tx,
                            tags,
                        };
                        Either3::A(rh.handle(response, auto_returns))
                    }
                    Err(te) => match te {
                        TestError::Recoverable(r) => {
                            let tags = tags.iter()
                                .filter_map(|(k, v)| {
                                    v.evaluate(Cow::Borrowed(template_values.as_json()), None)
                                        .ok()
                                        .map(move |v| (k.clone(), v))
                                }).collect();
                            let tags = Arc::new(tags);
                            let mut futures = Vec::new();
                            if outgoing.iter().any(|o| o.logger) {
                                let error = json::json!({
                                    "msg": format!("{}", r),
                                    "code": r.code(),
                                });
                                template_values.insert("error".into(), error);
                                let template_values: Arc<_> = template_values.0.into();
                                for o in outgoing.iter() {
                                    let select = o.select.clone();
                                    if let (true, Ok(iter)) =
                                        (o.logger, select.iter(template_values.clone()))
                                    {
                                        let iter = iter.map(|v| v.map_err(Into::into));
                                        let tx = o.tx.clone();
                                        let cb = o.cb.clone();
                                        futures.push(BlockSender::new(iter, tx, cb));
                                    }
                                }
                            }
                            let time = match r {
                                RecoverableError::Timeout(t)
                                | RecoverableError::ConnectionErr(t, _) => t,
                                _ => SystemTime::now(),
                            };
                            let rtt = match r {
                                RecoverableError::Timeout(_) => Some(timeout_in_micros),
                                _ => None,
                            };
                            for o in outgoing2.iter() {
                                if let Some(cb) = &o.cb {
                                    cb(false);
                                }
                            }
                            let _ = stats_tx
                                .unbounded_send(
                                    stats::ResponseStat {
                                        kind: stats::StatKind::RecoverableError(r),
                                        rtt,
                                        time,
                                        tags,
                                    }
                                    .into(),
                                );
                            let b = join_all(futures).map(|_| ());
                            Either3::B(b)
                        }
                        _ => Either3::C(Err(te).into_future()),
                    },
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
        });
        Either::A(a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create_http_client;
    use futures::{lazy, sync::mpsc as futures_channel};
    use tokio::runtime::current_thread;

    #[test]
    fn sends_request() {
        current_thread::run(lazy(|| {
            let (port, _) = test_common::start_test_server(None);
            let url = Template::simple(&format!("https://127.0.0.1:{}", port));
            let method = Method::GET;
            let headers = Vec::new();
            let body = BodyTemplate::None;
            let rr_providers = 0;
            let precheck_rr_providers = 0;
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
                rr_providers,
                client,
                stats_tx,
                no_auto_returns,
                outgoing,
                precheck_rr_providers,
                tags,
                timeout,
            };

            rm.send_request(Vec::new()).then(|r| {
                assert!(r.is_ok());
                Ok(())
            })
        }));
    }
}
