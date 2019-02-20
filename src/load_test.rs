use crate::channel;
use crate::config;
use crate::error::TestError;
use crate::providers;
use crate::request;
use crate::stats::{create_stats_channel, create_try_run_stats_channel, StatsMessage};
use crate::util::Either;

use futures::{
    future::{join_all, lazy, poll_fn},
    sink::Sink,
    stream,
    sync::mpsc::{Receiver as FCReceiver, Sender as FCSender},
    Async, Future, IntoFuture, Stream,
};
pub use hyper::{client::HttpConnector, Body, Client};
use hyper_tls::HttpsConnector;
use native_tls::TlsConnector;
use serde_json as json;

use std::{
    cmp,
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

type EndpointCalls = Box<dyn Future<Item = (), Error = ()> + Send + 'static>;

pub struct LoadTest {
    // how long the test will run for (can go longer due to waiting for responses)
    duration: Duration,
    // a list of futures for the endpoint tasks to run
    endpoint_calls: EndpointCalls,
    // channel to send stats related data
    stats_tx: request::StatsTx,
    // channel to kill the test
    test_killer: FCSender<Result<(), TestError>>,
}

type Builders = Vec<(
    String,
    Result<request::Builder, TestError>,
    Option<BTreeSet<String>>,
)>;
type TestEndedChannel = (
    FCSender<Result<(), TestError>>,
    FCReceiver<Result<(), TestError>>,
);

impl LoadTest {
    pub fn new(
        mut config: config::LoadTest,
        config_path: PathBuf,
        test_ended: TestEndedChannel,
        try_run: Option<String>,
    ) -> Result<Self, TestError> {
        let mut providers = BTreeMap::new();
        let mut static_providers = BTreeMap::new();

        let (test_ended_tx, test_ended_rx) = test_ended;
        let mut test_ended_rx = test_ended_rx
            .into_future()
            .then(|v| match v {
                Ok((Some(r), _)) => r,
                _ => Err(TestError::Internal(
                    "test_ended should not error at this point".into(),
                )),
            })
            .shared();

        let is_try_run = try_run.is_some();

        // build and register the providers
        let mut request_providers = Vec::new();
        let config_config = config.config;
        let auto_size = config_config.general.auto_buffer_start_size;
        for (name, template) in config.providers {
            let test_ended_rx = test_ended_rx.clone();
            let provider = match template {
                config::Provider::File(template) => {
                    // the auto_buffer_start_size is not the default
                    if auto_size != 5 {
                        if let channel::Limit::Auto(limit) = &template.buffer {
                            limit.store(auto_size, Ordering::Relaxed);
                        }
                    }
                    providers::file(template, test_ended_rx, test_ended_tx.clone(), &config_path)?
                }
                config::Provider::Range(range) => providers::range(range, test_ended_rx),
                config::Provider::Response(mut template) => {
                    if is_try_run {
                        template.buffer = channel::Limit::Integer(1);
                    } else if auto_size != 5 {
                        // the auto_buffer_start_size is not the default
                        if let channel::Limit::Auto(limit) = &template.buffer {
                            limit.store(auto_size, Ordering::Relaxed);
                        }
                    }
                    request_providers.push(name.clone());
                    providers::response(template)
                }
                config::Provider::Static(value) => {
                    static_providers.insert(name, value);
                    continue;
                }
                config::Provider::StaticList(values) => {
                    providers::literals(values, None, test_ended_rx)
                }
            };
            providers.insert(name, provider);
        }
        let providers = providers.into();

        let eppp_to_select = |eppp| config::Select::new(eppp, &static_providers);
        if is_try_run {
            let select = "`\
                          Request\n\
                          ========================================\n\
                          ${request['start-line']}\n\
                          ${join(request.headers, '\n', ': ')}\n\
                          ${if(request.body != '', '\n${request.body}', '')}\n\
                          \n\
                          Response (RTT: ${stats.rtt}ms)\n\
                          ========================================\n\
                          ${response['start-line']}\n\
                          ${join(response.headers, '\n', ': ')}\n\
                          ${if(response.body != '', '\n${response.body}', '')}\n`";
            let logger = json::json!({
                "select": select,
                "to": "stdout",
                "pretty": true
            });
            config.loggers.push((
                "try_run".into(),
                json::from_value(logger).expect("should be valid logger"),
            ));
        }
        // create the loggers
        let loggers = config
            .loggers
            .into_iter()
            .map(|(name, mut template)| {
                let test_ended_rx = test_ended_rx.clone();
                let select = template.select.take().map(eppp_to_select).transpose()?;
                Ok::<_, TestError>((
                    name,
                    (
                        providers::logger(
                            template,
                            test_ended_rx,
                            test_ended_tx.clone(),
                            &config_path,
                        ),
                        select,
                    ),
                ))
            })
            .collect::<Result<_, _>>()?;

        let global_load_pattern = config.load_pattern;
        let mut duration = Duration::new(0, 0);
        let to_select_values = |v: Vec<(String, config::EndpointProvidesPreProcessed)>| -> Result<Vec<(String, config::Select)>, TestError> {
            v.into_iter().map(|(s, eppp)| Ok((s, eppp_to_select(eppp)?)))
                .collect()
        };

        // create the endpoints
        let builders: Builders = config.endpoints.into_iter().enumerate().map(|(i, mut endpoint)| {
            let mut mod_interval: Option<Box<dyn Stream<Item = Instant, Error = TestError> + Send>> = None;
            let alias = endpoint.alias.unwrap_or_else(|| (i + 1).to_string());
            let provides_set = if is_try_run {
                Some(
                    endpoint
                        .provides
                        .iter_mut()
                        .map(|(k, eppp)| {
                            eppp.send = config::EndpointProvidesSendOptions::Block;
                            k.clone()
                        })
                        .collect::<BTreeSet<_>>(),
                )
            } else {
                None
            };
            let provides = match to_select_values(endpoint.provides) {
                Ok(p) => p,
                Err(e) => return (alias, Err(e), provides_set)
            };
            if let Some(peak_load) = endpoint.peak_load {
                let load_pattern = endpoint
                    .load_pattern
                    .as_ref()
                    .or_else(|| global_load_pattern.as_ref())
                    .ok_or_else(|| TestError::Other("missing load_pattern".into()));
                let load_pattern = match load_pattern {
                    Ok(l) => l,
                    Err(e) => return (alias, Err(e), provides_set)
                };
                match &try_run {
                    Some(target_endpoint) if &alias == target_endpoint => {
                        let stream = Ok(Instant::now()).into_future().into_stream();
                        mod_interval = Some(Box::new(stream));
                    }
                    None => {
                        let start: Box<dyn Stream<Item = Instant, Error = TestError> + Send> =
                        Box::new(stream::empty::<Instant, TestError>());
                        let mod_interval2 = load_pattern.iter().fold(start, |prev, lp| match lp {
                            config::LoadPattern::Linear(lb) => Box::new(prev.chain(lb.build(&peak_load))),
                        });
                        mod_interval = Some(mod_interval2);
                    }
                    _ => ()
                }
                let duration2 = load_pattern
                    .iter()
                    .fold(Duration::new(0, 0), |left, right| left + right.duration());
                duration = cmp::max(duration, duration2);
            } else if provides.is_empty() {
                return (alias, Err(TestError::Other(
                    "endpoint without peak_load must have `provides`".into(),
                )), provides_set);
            } else if provides
                .iter()
                .all(|(_, p)| p.get_send_behavior().is_if_not_full())
            {
                return (alias, Err(TestError::Other("endpoint without peak_load cannot have all the `provides` send behavior be `if_not_full`".into())), provides_set);
            }
            let mut headers: Vec<_> = config_config.client.headers.clone();
            headers.extend(endpoint.headers);
            let logs = match to_select_values(endpoint.logs) {
                Ok(l) => l,
                Err(e) => return (alias, Err(e), provides_set)
            };
            let builder = request::Builder::new(endpoint.url, mod_interval)
                .declare(endpoint.declare)
                .body(endpoint.body)
                .stats_id(endpoint.stats_id)
                .max_parallel_requests(endpoint.max_parallel_requests)
                .method(endpoint.method)
                .headers(headers)
                .provides(provides)
                .logs(logs);
            (
                alias,
                Ok(builder),
                provides_set,
            )
        }).collect();

        let client = {
            let mut http = HttpConnector::new_with_tokio_threadpool_resolver();
            http.set_keepalive(Some(config_config.client.keepalive));
            http.set_reuse_address(true);
            http.enforce_http(false);
            let https = HttpsConnector::from((
                http,
                TlsConnector::new().map_err(|e| {
                    TestError::Other(format!("could not create ssl connector: {}", e))
                })?,
            ));
            Client::builder().set_host(false).build::<_, Body>(https)
        };
        let stats_tx = if is_try_run {
            let (stats_tx, stats_rx) = create_try_run_stats_channel(test_ended_rx.clone());
            tokio::spawn(stats_rx);
            stats_tx
        } else {
            let (stats_tx, stats_rx) = create_stats_channel(
                test_ended_rx.clone(),
                test_ended_tx.clone(),
                &config_config.general,
            )?;
            tokio::spawn(stats_rx);
            stats_tx
        };

        let mut builder_ctx = request::BuilderContext {
            config: config_config,
            client: Arc::new(client),
            loggers,
            providers,
            static_providers,
            stats_tx: stats_tx.clone(),
            test_ended: test_ended_rx.clone(),
        };

        let endpoint_calls = match try_run {
            Some(target_endpoint) => {
                let mut request_providers: BTreeMap<_, _> = request_providers
                    .into_iter()
                    .map(|k| (k, Vec::new()))
                    .collect();
                let mut endpoints = BTreeMap::new();
                for (i, (alias, mut builder, mut provides)) in builders.into_iter().enumerate() {
                    if alias == target_endpoint {
                        provides = None;
                        builder = builder
                            .map(|b| b.provides(Vec::new()))
                    }
                    let endpoint = builder.and_then(|b| b.build(&mut builder_ctx, i)).map(|e| {
                        let mut required_request_providers = Vec::new();
                        for rp in &e.required_providers {
                            // create list of the request providers needed for this endpoint
                            if request_providers.contains_key(rp) {
                                required_request_providers.push(rp.clone());
                            }
                            // remove any provides that the endpoint also requires
                            if let Some(provides) = &mut provides {
                                provides.remove(rp);
                            }
                        }
                        (e, required_request_providers)
                    });
                    if endpoint.is_err() && alias == target_endpoint {
                        return Err(endpoint.err().expect("should be an error"));
                    }
                    endpoints.insert(alias.clone(), endpoint);
                    if let Some(provides) = provides {
                        for p in provides {
                            if let Some(v) = request_providers.get_mut(&p) {
                                v.push(alias.clone());
                            }
                        }
                    }
                }

                if !endpoints.contains_key(&*target_endpoint) {
                    return Err(TestError::Other(format!(
                        "could not find endpoint with alias `{}`",
                        target_endpoint
                    )));
                }

                let endpoint_scores: BTreeMap<_, _> = endpoints
                    .iter()
                    .map(|(alias, ep)| {
                        let score = ep.as_ref().map_err(|e| e.clone()).and_then(|(_, rrp)| {
                            calc_endpoint_score(
                                rrp,
                                maplit::btreeset!(alias.as_str()),
                                &request_providers,
                                &endpoints,
                            )
                        });
                        (alias, score)
                    })
                    .collect();

                let mut required_endpoints = BTreeSet::new();
                get_test_endpoints(
                    target_endpoint.clone(),
                    &mut required_endpoints,
                    &request_providers,
                    &endpoint_scores,
                    &endpoints,
                )?;

                let test_ended_tx = test_ended_tx.clone();
                let a = required_endpoints.into_iter().map(move |ep| {
                    let r = endpoints.remove(&ep).expect("endpoint should exist");
                    let r = if ep == target_endpoint {
                        let test_ended_tx = test_ended_tx.clone();
                        r.map(
                            move |e| -> Box<dyn Future<Item = (), Error = TestError> + Send> {
                                Box::new(e.0.into_future().and_then(|_| {
                                    test_ended_tx
                                        .send(Ok(()))
                                        .map(|_| ())
                                        .map_err(|_| TestError::ProviderEnded(None))
                                }))
                            },
                        )
                    } else {
                        r.map(|e| e.0.into_future())
                    };
                    r.into_future().flatten()
                });
                Either::A(a)
            }
            None => {
                let b = builders
                    .into_iter()
                    .enumerate()
                    .map(move |(i, (_, builder, _))| {
                        builder
                            .and_then(|b| b.build(&mut builder_ctx, i))
                            .map(|e| e.into_future())
                            .into_future()
                            .flatten()
                    })
                    .map(|e| e);
                Either::B(b)
            }
        };

        let test_ended_tx2 = test_ended_tx.clone();
        let endpoint_calls: EndpointCalls = Box::new(
            join_all(endpoint_calls)
                .map(|_r| ())
                .select(lazy(move || {
                    let test_end = Instant::now() + duration;
                    poll_fn(
                        move || match (test_ended_rx.poll(), Instant::now() >= test_end) {
                            (Ok(Async::NotReady), false) => Ok(Async::NotReady),
                            (Ok(Async::Ready(_)), _) | (Ok(Async::NotReady), true) => {
                                Ok(Async::Ready(()))
                            }
                            (Err(e), _) => Err((&*e).clone()),
                        },
                    )
                }))
                .map(|_| ())
                .map_err(|e| e.0)
                .then(move |r| test_ended_tx2.send(r).then(|_| Ok(()))),
        );

        Ok(LoadTest {
            endpoint_calls,
            duration,
            stats_tx,
            test_killer: test_ended_tx,
        })
    }

    pub fn run(self) -> impl Future<Item = (), Error = ()> {
        let endpoint_calls = self.endpoint_calls;
        let test_killer = self.test_killer;
        self.stats_tx
            .send(StatsMessage::Start(self.duration))
            .map_err(|_| TestError::ProviderEnded(None))
            .then(move |r| match r {
                Ok(_) => Either::A(endpoint_calls),
                Err(e) => Either::B(test_killer.send(Err(e)).then(|_| Ok(()))),
            })
    }
}

type Endpoints<F> = BTreeMap<String, Result<(request::Endpoint<F>, Vec<String>), TestError>>;

fn calc_endpoint_score<F>(
    required_request_providers: &[String],
    dont_visit: BTreeSet<&str>,
    request_providers: &BTreeMap<String, Vec<String>>,
    endpoints: &Endpoints<F>,
) -> Result<usize, TestError>
where
    F: Future + Send + 'static,
    <F as Future>::Error: Send + Sync,
    <F as Future>::Item: Send + Sync,
{
    let mut score = 0;
    for rrp in required_request_providers {
        let endpoint_providers = request_providers
            .get(&*rrp)
            .expect("should have request provider listed");
        let start_err = Err(format!(
            "requires response provider `{}` but no other endpoint could provide it",
            rrp
        ));
        if endpoint_providers.is_empty() {
            return start_err.map_err(TestError::Other);
        }
        let v = endpoint_providers.iter().fold(start_err, |mut prev, ep| {
            if dont_visit.contains(ep.as_str()) {
                return prev;
            }
            let endpoint = endpoints.get(ep).expect("endpoint should exist");
            match (&mut prev, endpoint) {
                (_, Ok((_, rp))) => {
                    let mut dont_visit = dont_visit.clone();
                    dont_visit.insert(ep);
                    let score = calc_endpoint_score(rp, dont_visit, request_providers, endpoints);
                    match (&prev, score) {
                        (Ok(p), Ok(s)) => Ok(cmp::min(*p, s)),
                        (_, Ok(s)) => Ok(s),
                        _ => prev,
                    }
                }
                (Err(p), Err(curr)) => {
                    let msg = format!("{}", curr);
                    let msg = msg.replace('\n', "\n\t");
                    p.push_str(&format!(
                        "\n`{}` could have provided `{}` but had the error:\n\t{}",
                        ep, rrp, msg
                    ));
                    prev
                }
                (_, Err(_)) => prev,
            }
        });
        if let Ok(n) = v {
            score += n;
        } else {
            return v.map_err(TestError::Other);
        }
    }
    Ok(score)
}

fn get_test_endpoints<F>(
    target_endpoint: String,
    test_endpoints: &mut BTreeSet<String>,
    request_providers: &BTreeMap<String, Vec<String>>,
    endpoint_scores: &BTreeMap<&String, Result<usize, TestError>>,
    endpoints: &Endpoints<F>,
) -> Result<(), TestError>
where
    F: Future + Send + 'static,
    <F as Future>::Error: Send + Sync,
    <F as Future>::Item: Send + Sync,
{
    if test_endpoints.contains(&target_endpoint) {
        return Ok(());
    }
    let required_request_providers = match endpoints
        .get(&target_endpoint)
        .expect("endpoint should exist")
    {
        Ok((_, r)) => r,
        Err(e) => return Err(e.clone()),
    };
    test_endpoints.insert(target_endpoint.clone());
    for rrp in required_request_providers {
        let rp = request_providers
            .get(rrp.as_str())
            .expect("endpoint should exist");
        let start_err = Err(format!(
            "endpoint `{}` requires response provider `{}` but no other endpoint could provide it",
            target_endpoint, rrp
        ));
        let ep = rp.iter().fold(start_err, |mut prev, ep| {
            if test_endpoints.contains(ep.as_str()) {
                return Ok((ep, 0usize));
            }
            let score = endpoint_scores
                .get(ep)
                .expect("endpoint score should exist");
            match (&mut prev, score) {
                (Ok((_, p)), Ok(n)) if n < p => Ok((ep, *n)),
                (Err(_), Ok(n)) => Ok((ep, *n)),
                (Err(ref mut p), Err(curr)) => {
                    let msg = format!("{}", curr);
                    let msg = msg.replace('\n', "\n\t");
                    p.push_str(&format!(
                        "\n`{}` could have provided `{}` but had the error:\n\t{}",
                        ep, rrp, msg
                    ));
                    prev
                }
                _ => prev,
            }
        });
        match ep {
            Ok((ep, _)) => {
                get_test_endpoints(
                    ep.clone(),
                    test_endpoints,
                    request_providers,
                    endpoint_scores,
                    endpoints,
                )?;
            }
            Err(msg) => return Err(TestError::Other(msg)),
        }
    }
    Ok(())
}
