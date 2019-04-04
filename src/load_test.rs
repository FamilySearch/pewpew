use crate::config;
use crate::error::TestError;
use crate::providers;
use crate::request;
use crate::stats::{create_stats_channel, create_try_run_stats_channel, StatsMessage};
use crate::util::tweak_path;

use ether::{Either, Either3};
use futures::{
    future::{self, join_all, lazy},
    sink::Sink,
    sync::{
        mpsc::{self as futures_channel, Receiver as FCReceiver, Sender as FCSender},
        oneshot,
    },
    Future, IntoFuture, Stream,
};
pub use hyper::{client::HttpConnector, Body, Client};
use hyper_tls::HttpsConnector;
use indexmap::IndexSet;
use native_tls::TlsConnector;
use serde_json as json;
use tokio::io::{write_all, AsyncWrite};
use yansi::Paint;

use std::{
    cmp,
    collections::{BTreeMap, BTreeSet},
    fs::File,
    mem,
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

#[derive(Copy, Clone, Debug)]
pub enum TestEndReason {
    Completed,
    KilledByLogger,
    ProviderEnded,
}

type TestEndedChannel = (
    FCSender<Result<TestEndReason, TestError>>,
    FCReceiver<Result<TestEndReason, TestError>>,
);

pub fn create_run<Se, So, Sef, Sof>(
    config_file: PathBuf,
    target_endpoint: Option<String>,
    stdout: Sof,
    stderr: Sef,
) -> impl Future<Item = (), Error = ()>
where
    Se: AsyncWrite + Send + Sync + 'static,
    So: AsyncWrite + Send + Sync + 'static,
    Sef: Fn() -> Se,
    Sof: Fn() -> So,
{
    let stderr2 = stderr();
    lazy(move || {
        // TODO: change this to use tokio::fs::File
        let file = match File::open(&config_file) {
            Ok(f) => f,
            Err(_) => {
                let e = TestError::InvalidConfigFilePath(config_file);
                return Either3::B(Err(e).into_future());
            }
        };
        let config = match serde_yaml::from_reader(file) {
            Ok(c) => c,
            Err(e) => {
                let e = TestError::YamlDeserializerErr(e.into());
                return Either3::B(Err(e).into_future());
            }
        };
        let (test_ended_tx, test_ended_rx) = futures_channel::channel(0);
        let work = if let Some(target_endpoint) = target_endpoint {
            create_try_run_future(
                config,
                config_file,
                (test_ended_tx.clone(), test_ended_rx),
                target_endpoint,
                stdout,
                stderr,
            )
            .map(Either::A)
        } else {
            create_load_test_future(
                config,
                config_file,
                (test_ended_tx.clone(), test_ended_rx),
                stdout,
                stderr,
            )
            .map(Either::B)
        };
        match work {
            Ok(a) => Either3::A(a),
            Err(e) => {
                // send the test_ended message in case the stats monitor
                // is running
                let c = test_ended_tx
                    .send(Ok(TestEndReason::Completed))
                    .then(|_| Err::<TestEndReason, _>(e));
                Either3::C(c)
            }
        }
    })
    .then(move |r| {
        let f = match &r {
            Err(e) => {
                let a = write_all(
                    stderr2,
                    format!("\n{} {}", Paint::red("Fatal error").bold(), e),
                );
                Either::A(a)
            }
            Ok(TestEndReason::KilledByLogger) => {
                let a = write_all(
                    stderr2,
                    format!("\n{}", Paint::yellow("Test killed early by logger").bold()),
                );
                Either::A(a)
            }
            Ok(TestEndReason::ProviderEnded) => {
                let a = write_all(
                    stderr2,
                    format!(
                        "\n{}",
                        Paint::yellow("Test ended early because one or more providers ended")
                    ),
                );
                Either::A(a)
            }
            _ => Either::B(Ok::<_, ()>(()).into_future()),
        };
        f.map_a(|a| a.then(|_| Ok(())))
            .then(move |_| r)
            .map(|_| ())
            .map_err(|_| ())
    })
}

fn create_try_run_future<Se, So, Sef, Sof>(
    mut config: config::LoadTest,
    config_path: PathBuf,
    test_ended: TestEndedChannel,
    try_run: String,
    stdout: Sof,
    stderr: Sef,
) -> Result<impl Future<Item = TestEndReason, Error = TestError>, TestError>
where
    Se: AsyncWrite + Send + Sync + 'static,
    So: AsyncWrite + Send + Sync + 'static,
    Sef: Fn() -> Se,
    Sof: Fn() -> So,
{
    let (test_ended_tx, test_ended_rx) = test_ended;
    let test_ended_rx = test_ended_rx
        .into_future()
        .then(|v| match v {
            Ok((Some(r), _)) => r,
            _ => Err(TestError::Internal(
                "test_ended should not error at this point".into(),
            )),
        })
        .shared();

    let config_config = config.config;

    // build and register the providers
    let (providers, static_providers, mut request_providers) = get_providers_from_config(
        config.providers,
        config_config.general.auto_buffer_start_size,
        &test_ended_tx,
        &config_path,
    )?;

    let eppp_to_select = |eppp| config::Select::new(eppp, &static_providers);
    let select = "`\
                  Request\n\
                  ========================================\n\
                  ${request['start-line']}\n\
                  ${join(request.headers, '\n', ': ')}\n\
                  ${if(request.body != '', '\n${request.body}\n', '')}\n\
                  Response (RTT: ${stats.rtt}ms)\n\
                  ========================================\n\
                  ${response['start-line']}\n\
                  ${join(response.headers, '\n', ': ')}\n\
                  ${if(response.body != '', '\n${response.body}', '')}\n\n`";
    let logger = json::json!({
        "select": select,
        "to": "stdout",
        "pretty": true
    });
    config.loggers.push((
        "try_run".into(),
        json::from_value(logger).expect("should be valid logger"),
    ));

    // create the loggers
    let loggers = get_loggers_from_config(
        config.loggers,
        &config_path,
        &test_ended_tx,
        &static_providers,
        stdout,
        stderr,
    )?;

    let to_select_values = |v: Vec<(String, config::EndpointProvidesPreProcessed)>| -> Result<Vec<(String, config::Select)>, TestError> {
        v.into_iter().map(|(s, eppp)| Ok((s, eppp_to_select(eppp)?)))
            .collect()
    };

    // create the endpoints
    let builders: Vec<_> = config
        .endpoints
        .into_iter()
        .enumerate()
        .map(|(i, mut endpoint)| {
            let alias = endpoint.alias.unwrap_or_else(|| (i + 1).to_string());
            let provides_set = endpoint
                .provides
                .iter_mut()
                .map(|(k, eppp)| {
                    eppp.send = config::EndpointProvidesSendOptions::Block;
                    k.clone()
                })
                .collect::<BTreeSet<_>>();
            let provides = match to_select_values(endpoint.provides) {
                Ok(p) => p,
                Err(e) => return (alias, Err(e), provides_set),
            };
            let mod_interval: Option<Box<dyn Stream<Item = Instant, Error = TestError> + Send>> =
                if alias == try_run {
                    let stream = Ok(Instant::now()).into_future().into_stream();
                    Some(Box::new(stream))
                } else {
                    None
                };
            let mut headers: Vec<_> = config_config.client.headers.clone();
            headers.extend(endpoint.headers);
            let logs = match to_select_values(endpoint.logs) {
                Ok(l) => l,
                Err(e) => return (alias, Err(e), provides_set),
            };
            let builder = request::Builder::new(endpoint.url, mod_interval)
                .body(endpoint.body)
                .declare(endpoint.declare)
                .headers(headers)
                .logs(logs)
                .max_parallel_requests(endpoint.max_parallel_requests)
                .method(endpoint.method)
                .no_auto_returns(endpoint.no_auto_returns)
                .on_demand(true)
                .provides(provides)
                .stats_id(endpoint.stats_id);
            (alias, Ok(builder), provides_set)
        })
        .collect();

    let client = create_http_client(config_config.client.keepalive)?;

    let (stats_tx, stats_rx) = create_try_run_stats_channel(test_ended_rx.clone());
    let (tx, stats_done) = oneshot::channel::<()>();
    tokio::spawn(stats_rx.then(move |_| {
        drop(tx);
        Ok(())
    }));

    let mut builder_ctx = request::BuilderContext {
        config: config_config,
        config_path,
        client: Arc::new(client),
        loggers,
        providers,
        static_providers,
        stats_tx: stats_tx.clone(),
    };

    let mut endpoints = BTreeMap::new();

    for (i, (alias, mut builder, mut provides)) in builders.into_iter().enumerate() {
        if alias == try_run {
            provides.clear();
            builder = builder.map(|b| b.provides(Vec::new()))
        }
        let endpoint = builder.and_then(|b| b.build(&mut builder_ctx, i)).map(|e| {
            let mut required_request_providers = Vec::new();
            for rp in e.required_providers() {
                // create list of the request providers needed for this endpoint
                if request_providers.contains_key(rp) {
                    required_request_providers.push(rp.clone());
                }
                // remove any provides that the endpoint also requires
                provides.remove(rp);
            }
            (e, required_request_providers)
        });
        if endpoint.is_err() && alias == try_run {
            return Err(endpoint.err().expect("should be an error"));
        }
        endpoints.insert(alias.clone(), endpoint);
        for p in provides {
            if let Some(v) = request_providers.get_mut(&p) {
                v.push(alias.clone());
            }
        }
    }

    if !endpoints.contains_key(&try_run) {
        return Err(TestError::Other(
            format!("could not find endpoint with alias `{}`", try_run).into(),
        ));
    }

    let endpoint_scores: BTreeMap<_, _> = endpoints
        .iter()
        .map(|(alias, ep)| {
            let score = ep
                .as_ref()
                .map_err(Clone::clone)
                .and_then(|(endpoint, rrp)| {
                    calc_endpoint_score(
                        endpoint,
                        rrp,
                        maplit::btreeset!(alias.as_str()),
                        &request_providers,
                        &endpoints,
                    )
                });
            (alias.as_str(), score)
        })
        .collect();

    let mut endpoints_needed_for_test = IndexSet::new();
    get_test_endpoints(
        &try_run,
        &mut endpoints_needed_for_test,
        &request_providers,
        &endpoint_scores,
        &endpoints,
    )?;

    let test_ended_tx = test_ended_tx.clone();
    let test_ended_tx2 = test_ended_tx.clone();

    let endpoint_calls = endpoints_needed_for_test.into_iter().map(move |ep| {
        let r = endpoints.remove(&ep).expect("endpoint should exist");
        let r = if ep == try_run {
            let test_ended_tx = test_ended_tx.clone();
            r.map(
                move |e| -> Box<dyn Future<Item = (), Error = TestError> + Send> {
                    Box::new(e.0.into_future().and_then(|_| {
                        test_ended_tx
                            .send(Ok(TestEndReason::Completed))
                            .map(|_| ())
                            .map_err(|_| TestError::Internal("Sending test ended signal".into()))
                    }))
                },
            )
        } else {
            r.map(|e| e.0.into_future())
        };
        r.into_future().flatten()
    });

    let endpoint_calls = join_all(endpoint_calls)
        .map(|_| TestEndReason::Completed)
        .then(move |r| test_ended_tx2.send(r.clone()).then(|_| r))
        .select(test_ended_rx.map(|r| *r).map_err(|e| (&*e).clone()))
        .map(|r| r.0)
        .map_err(|e| e.0)
        .then(move |r| stats_done.then(move |_| r));

    Ok(endpoint_calls)
}

pub fn create_load_test_future<Se, So, Sef, Sof>(
    config: config::LoadTest,
    config_path: PathBuf,
    test_ended: TestEndedChannel,
    stdout: Sof,
    stderr: Sef,
) -> Result<impl Future<Item = TestEndReason, Error = TestError>, TestError>
where
    Se: AsyncWrite + Send + Sync + 'static,
    So: AsyncWrite + Send + Sync + 'static,
    Sef: Fn() -> Se,
    Sof: Fn() -> So,
{
    let (test_ended_tx, test_ended_rx) = test_ended;
    let test_ended_rx = test_ended_rx
        .into_future()
        .then(|v| match v {
            Ok((Some(r), _)) => r,
            _ => Err(TestError::Internal(
                "test_ended should not error at this point".into(),
            )),
        })
        .shared();

    let config_config = config.config;

    // build and register the providers
    let (providers, static_providers, _) = get_providers_from_config(
        config.providers,
        config_config.general.auto_buffer_start_size,
        &test_ended_tx,
        &config_path,
    )?;

    let eppp_to_select = |eppp| config::Select::new(eppp, &static_providers);

    // create the loggers
    let loggers = get_loggers_from_config(
        config.loggers,
        &config_path,
        &test_ended_tx,
        &static_providers,
        stdout,
        stderr,
    )?;

    let global_load_pattern = config.load_pattern;
    let mut duration = Duration::new(0, 0);
    let to_select_values = |v: Vec<(String, config::EndpointProvidesPreProcessed)>| -> Result<Vec<(String, config::Select)>, TestError> {
        v.into_iter().map(|(s, eppp)| Ok((s, eppp_to_select(eppp)?)))
            .collect()
    };

    // create the endpoints
    let builders: Vec<_> = config.endpoints.into_iter().map(|endpoint| {
        let mut mod_interval: Option<Box<dyn Stream<Item = Instant, Error = TestError> + Send>> = None;
        let provides = to_select_values(endpoint.provides)?;
        if let Some(peak_load) = endpoint.peak_load {
            let load_pattern = endpoint
                .load_pattern
                .or_else(|| global_load_pattern.clone())
                .ok_or_else(|| TestError::Other("missing load_pattern".into()))?;
            duration = cmp::max(duration, load_pattern.duration());
            mod_interval = Some(Box::new(load_pattern.build(&peak_load)));
        } else if provides.is_empty() {
            return Err(TestError::Other(
                "endpoint must have `provides` or `peak_load`".into(),
            ));
        } else if provides
            .iter()
            .all(|(_, p)| !p.get_send_behavior().is_block())
        {
            return Err(TestError::Other("endpoint without `peak_load` must have at least one `provides` with `send: block`".into()));
        }
        let mut headers: Vec<_> = config_config.client.headers.clone();
        headers.extend(endpoint.headers);
        let logs = to_select_values(endpoint.logs)?;
        let builder = request::Builder::new(endpoint.url, mod_interval)
            .body(endpoint.body)
            .declare(endpoint.declare)
            .headers(headers)
            .logs(logs)
            .max_parallel_requests(endpoint.max_parallel_requests)
            .method(endpoint.method)
            .no_auto_returns(endpoint.no_auto_returns)
            .on_demand(endpoint.on_demand)
            .provides(provides)
            .stats_id(endpoint.stats_id);
        Ok(builder)
    }).collect::<Result<_, _>>()?;

    let client = create_http_client(config_config.client.keepalive)?;

    let (stats_tx, stats_rx) = create_stats_channel(
        test_ended_rx.clone(),
        test_ended_tx.clone(),
        &config_config.general,
        &providers,
    )?;
    let (tx, stats_done) = oneshot::channel::<()>();
    tokio::spawn(stats_rx.then(move |_| {
        drop(tx);
        Ok(())
    }));

    let mut builder_ctx = request::BuilderContext {
        config: config_config,
        config_path,
        client: Arc::new(client),
        loggers,
        providers,
        static_providers,
        stats_tx: stats_tx.clone(),
    };

    let endpoint_calls = builders.into_iter().enumerate().map(move |(i, builder)| {
        builder
            .build(&mut builder_ctx, i)
            .map(request::Endpoint::into_future)
            .into_future()
            .flatten()
    });

    let test_ended_tx2 = test_ended_tx.clone();
    let endpoint_calls = stats_tx
        .send(StatsMessage::Start(duration))
        .map_err(|_| TestError::Internal("Error sending test start signal".into()))
        .then(move |r| match r {
            Ok(_) => {
                let test_end = Instant::now() + duration;
                let a = join_all(endpoint_calls)
                    .map(move |_r| {
                        if Instant::now() >= test_end {
                            TestEndReason::Completed
                        } else {
                            TestEndReason::ProviderEnded
                        }
                    })
                    .select(
                        tokio::timer::Delay::new(test_end)
                            .map(|_| TestEndReason::Completed)
                            .map_err(Into::into),
                    )
                    .map(|r| r.0)
                    .map_err(|e| e.0)
                    .then(|r| test_ended_tx2.send(r.clone()).then(|_| r));
                Either::A(a)
            }
            Err(e) => {
                let e = Err(e);
                Either::B(test_ended_tx.send(e.clone()).then(|_| e))
            }
        })
        .select(test_ended_rx.map(|r| *r).map_err(|e| (&*e).clone()))
        .map(|r| r.0)
        .map_err(|e| e.0)
        .then(move |r| stats_done.then(move |_| r));

    Ok(endpoint_calls)
}

fn create_http_client(
    keepalive: Duration,
) -> Result<
    Client<HttpsConnector<HttpConnector<hyper::client::connect::dns::TokioThreadpoolGaiResolver>>>,
    TestError,
> {
    let mut http = HttpConnector::new_with_tokio_threadpool_resolver();
    http.set_keepalive(Some(keepalive));
    http.set_reuse_address(true);
    http.enforce_http(false);
    let https = HttpsConnector::from((
        http,
        TlsConnector::new().map_err(|e| {
            TestError::Other(format!("could not create ssl connector: {}", e).into())
        })?,
    ));
    Ok(Client::builder().set_host(false).build::<_, Body>(https))
}

fn calc_endpoint_score(
    endpoint: &request::Endpoint,
    required_request_providers: &[String],
    dont_visit: BTreeSet<&str>,
    request_providers: &BTreeMap<String, Vec<String>>,
    endpoints: &BTreeMap<String, Result<(request::Endpoint, Vec<String>), TestError>>,
) -> Result<usize, TestError> {
    let mut score = if endpoint.method() == hyper::Method::GET {
        0
    } else {
        5
    };
    for rrp in required_request_providers {
        let endpoint_providers = request_providers
            .get(rrp)
            .expect("should have request provider listed");
        let start_err = Err(format!(
            "requires response provider `{}` but no other endpoint could provide it",
            rrp
        ));
        if endpoint_providers.is_empty() {
            return start_err.map_err(|e| TestError::Other(e.into()));
        }
        let v = endpoint_providers.iter().fold(start_err, |mut prev, ep| {
            if dont_visit.contains(ep.as_str()) {
                return prev;
            }
            let endpoint = endpoints.get(ep).expect("endpoint should exist");
            match (&mut prev, endpoint) {
                (_, Ok((endpoint, rp))) => {
                    let mut dont_visit = dont_visit.clone();
                    dont_visit.insert(ep);
                    let score =
                        calc_endpoint_score(endpoint, rp, dont_visit, request_providers, endpoints)
                            .map(|s| s + 10);
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
            return v.map_err(|s| TestError::Other(s.into()));
        }
    }
    Ok(score)
}

fn get_test_endpoints(
    target_endpoint: &str,
    endpoints_needed_for_test: &mut IndexSet<String>,
    request_providers: &BTreeMap<String, Vec<String>>,
    endpoint_scores: &BTreeMap<&str, Result<usize, TestError>>,
    endpoints: &BTreeMap<String, Result<(request::Endpoint, Vec<String>), TestError>>,
) -> Result<(), TestError> {
    if endpoints_needed_for_test.contains(target_endpoint) {
        return Ok(());
    }
    let required_request_providers = match endpoints
        .get(target_endpoint)
        .expect("endpoint should exist")
    {
        Ok((_, r)) => r,
        Err(e) => return Err(e.clone()),
    };
    endpoints_needed_for_test.insert(target_endpoint.to_string());
    for rrp in required_request_providers {
        let request_providers2 = request_providers.get(rrp).expect("endpoint should exist");
        let mut provider_endpoints: Vec<_> = request_providers2
            .iter()
            .filter_map(|ep| {
                endpoint_scores
                    .get(ep.as_str())
                    .expect("endpoint score should exist")
                    .as_ref()
                    .ok()
                    .map(move |score| (ep, score))
            })
            .collect();
        if provider_endpoints.is_empty() {
            let start_err_msg = format!(
                "endpoint `{}` requires response provider `{}` but no other endpoint could provide it",
                target_endpoint, rrp
            );
            let err_msg = request_providers2
                .iter()
                .fold(start_err_msg, |mut err_msg, rp| {
                    let score = endpoint_scores
                        .get(rp.as_str())
                        .expect("endpoint score should exist");
                    if let Err(e) = score {
                        let msg = format!("{}", e).replace('\n', "\n\t");
                        err_msg.push_str(&format!(
                            "\n`{}` could have provided `{}` but had the error:\n\t{}",
                            rp, rrp, msg
                        ));
                    }
                    err_msg
                });
            return Err(TestError::Other(err_msg.into()));
        }
        provider_endpoints.sort_unstable_by_key(|(_, score)| *score);
        for (ep, _) in provider_endpoints {
            get_test_endpoints(
                ep,
                endpoints_needed_for_test,
                request_providers,
                endpoint_scores,
                endpoints,
            )?;
        }
    }
    Ok(())
}

type ProvidersResult = Result<
    (
        BTreeMap<String, providers::Provider>,
        BTreeMap<String, json::Value>,
        BTreeMap<String, Vec<String>>,
    ),
    TestError,
>;

fn get_providers_from_config(
    config_providers: Vec<(String, config::Provider)>,
    auto_size: usize,
    test_ended_tx: &FCSender<Result<TestEndReason, TestError>>,
    config_path: &PathBuf,
) -> ProvidersResult {
    let mut providers = BTreeMap::new();
    let mut static_providers = BTreeMap::new();
    let mut request_providers = BTreeMap::new();
    for (name, template) in config_providers {
        let provider = match template {
            config::Provider::File(template) => {
                // the auto_buffer_start_size is not the default
                if auto_size != 5 {
                    if let channel::Limit::Auto(limit) = &template.buffer {
                        limit.store(auto_size, Ordering::Relaxed);
                    }
                }
                providers::file(template, test_ended_tx.clone(), config_path)?
            }
            config::Provider::Range(range) => providers::range(range),
            config::Provider::Response(template) => {
                request_providers.insert(name.clone(), Vec::new());
                providers::response(template)
            }
            config::Provider::Static(value) => {
                static_providers.insert(name, value);
                continue;
            }
            config::Provider::StaticList(values) => providers::literals(values),
        };
        providers.insert(name, provider);
    }
    Ok((providers, static_providers, request_providers))
}

type LoggersResult =
    Result<BTreeMap<String, (channel::Sender<json::Value>, Option<config::Select>)>, TestError>;

fn get_loggers_from_config<Se, So, Sef, Sof>(
    config_loggers: Vec<(String, config::Logger)>,
    config_path: &PathBuf,
    test_ended_tx: &FCSender<Result<TestEndReason, TestError>>,
    static_providers: &BTreeMap<String, json::Value>,
    stdout: Sof,
    stderr: Sef,
) -> LoggersResult
where
    Se: AsyncWrite + Send + Sync + 'static,
    So: AsyncWrite + Send + Sync + 'static,
    Sef: Fn() -> Se,
    Sof: Fn() -> So,
{
    config_loggers
        .into_iter()
        .map(|(name, mut template)| {
            let writer_future = match template.to.as_str() {
                "stderr" => Either::A(future::ok(Either3::A(stderr()))),
                "stdout" => Either::A(future::ok(Either3::B(stdout()))),
                _ => {
                    let mut path = mem::replace(&mut template.to, String::new());
                    tweak_path(&mut path, config_path);
                    let name2 = name.clone();
                    let f = tokio::fs::File::create(path)
                        .map(Either3::C)
                        .map_err(move |e| {
                            TestError::Other(
                                format!("creating logger file for `{:?}`: {}", name2, e).into(),
                            )
                        });
                    Either::B(f)
                }
            };
            let select = template
                .select
                .take()
                .map(|eppp| config::Select::new(eppp, &static_providers))
                .transpose()?;
            let sender =
                providers::logger(name.clone(), template, test_ended_tx.clone(), writer_future);
            Ok::<_, TestError>((name, (sender, select)))
        })
        .collect()
}
