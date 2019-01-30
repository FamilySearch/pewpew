use crate::channel;
use crate::config;
use crate::error::TestError;
use crate::providers;
use crate::request;
use crate::stats::{create_stats_channel, StatsMessage};
use crate::util::Either;

use chrono::{Duration as ChronoDuration, Local};
use futures::{
    future::{join_all, lazy, poll_fn},
    sink::Sink,
    stream,
    sync::mpsc::{self as futures_channel, Sender as FCSender},
    Async, Future, IntoFuture, Stream,
};
pub use hyper::{client::HttpConnector, Body, Client};
use hyper_tls::HttpsConnector;
use native_tls::TlsConnector;

use std::{
    cmp,
    collections::BTreeMap,
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

type EndpointCalls = Box<Future<Item = (), Error = ()> + Send + 'static>;

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

impl LoadTest {
    pub fn new(config: config::LoadTest, config_path: PathBuf) -> Result<Self, TestError> {
        let mut providers = BTreeMap::new();
        let mut static_providers = BTreeMap::new();

        let (test_ended_tx, test_ended_rx) = futures_channel::channel::<Result<(), TestError>>(0);
        let mut test_ended_rx = test_ended_rx
            .into_future()
            .then(|v| match v {
                Ok((Some(r), _)) => r,
                _ => Err(TestError::Internal(
                    "test_ended should not error at this point".into(),
                )),
            })
            .shared();

        // build and register the providers
        let auto_size = config.config.general.auto_buffer_start_size;
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
                config::Provider::Response(template) => {
                    // the auto_buffer_start_size is not the default
                    if auto_size != 5 {
                        if let channel::Limit::Auto(limit) = &template.buffer {
                            limit.store(auto_size, Ordering::Relaxed);
                        }
                    }
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
        let mut builders = Vec::new();
        // create the endpoints
        for endpoint in config.endpoints {
            let mut mod_interval = None;
            let to_select_values = |v: Vec<(String, config::EndpointProvidesPreProcessed)>| -> Result<Vec<(String, config::Select)>, TestError> {
                v.into_iter().map(|(s, eppp)| Ok((s, eppp_to_select(eppp)?)))
                    .collect()
            };
            let provides = to_select_values(endpoint.provides)?;
            if let Some(peak_load) = endpoint.peak_load {
                let load_pattern = endpoint
                    .load_pattern
                    .as_ref()
                    .or_else(|| global_load_pattern.as_ref())
                    .ok_or_else(|| TestError::Other("missing load_pattern".into()))?;
                let start: Box<dyn Stream<Item = Instant, Error = TestError> + Send> =
                    Box::new(stream::empty::<Instant, TestError>());
                let mod_interval2 = load_pattern.iter().fold(start, |prev, lp| match lp {
                    config::LoadPattern::Linear(lb) => Box::new(prev.chain(lb.build(&peak_load))),
                });
                mod_interval = Some(mod_interval2);
                let duration2 = load_pattern
                    .iter()
                    .fold(Duration::new(0, 0), |left, right| left + right.duration());
                duration = cmp::max(duration, duration2);
            } else if provides.is_empty() {
                return Err(TestError::Other(
                    "endpoint without peak_load must have `provides`".into(),
                ));
            } else if provides
                .iter()
                .all(|(_, p)| p.get_send_behavior().is_if_not_full())
            {
                return Err(TestError::Other("endpoint without peak_load cannot have all the `provides` send behavior be `if_not_full`".into()));
            }
            let mut headers: Vec<_> = config.config.client.headers.clone();
            headers.extend(endpoint.headers);
            let builder = request::Builder::new(endpoint.url, mod_interval)
                .declare(endpoint.declare)
                .body(endpoint.body)
                .stats_id(endpoint.stats_id)
                .method(endpoint.method)
                .headers(headers)
                .provides(provides)
                .logs(to_select_values(endpoint.logs)?);
            builders.push(builder);
        }

        let client = {
            let mut http = HttpConnector::new_with_tokio_threadpool_resolver();
            http.set_keepalive(Some(config.config.client.keepalive));
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

        let (stats_tx, stats_rx) = create_stats_channel(
            test_ended_rx.clone(),
            test_ended_tx.clone(),
            &config.config.general,
        )?;
        tokio::spawn(stats_rx);

        let mut builder_ctx = request::BuilderContext {
            config: config.config,
            client: Arc::new(client),
            loggers,
            providers,
            static_providers,
            stats_tx: stats_tx.clone(),
            test_ended: test_ended_rx.clone(),
        };

        let endpoint_calls =
            builders.into_iter().enumerate().map(move |(i, builder)| {
                match builder.build(&mut builder_ctx, i) {
                    Ok(e) => Either::A(e.into_future()),
                    Err(e) => Either::B(Err(e).into_future()),
                }
            });

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
        let test_end_message = duration_till_end_to_pretty_string(self.duration);
        let endpoint_calls = self.endpoint_calls;
        let test_killer = self.test_killer;
        self.stats_tx
            .send(StatsMessage::EndTime(Instant::now() + self.duration))
            .map_err(|_| TestError::ProviderEnded(None))
            .then(move |r| match r {
                Ok(_) => {
                    eprint!("{}", format!("Starting load test. {}\n", test_end_message));
                    Either::A(endpoint_calls)
                }
                Err(e) => Either::B(test_killer.send(Err(e)).then(|_| Ok(()))),
            })
    }
}

pub fn duration_till_end_to_pretty_string(duration: Duration) -> String {
    let long_form = duration_to_pretty_long_form(duration);
    let msg = if let Some(s) = duration_to_pretty_short_form(duration) {
        format!("{} {}", s, long_form)
    } else {
        long_form
    };
    format!("Test will end {}", msg)
}

fn duration_to_pretty_short_form(duration: Duration) -> Option<String> {
    if let Ok(duration) = ChronoDuration::from_std(duration) {
        let now = Local::now();
        let end = now + duration;
        Some(format!("around {}", end.format("%T %-e-%b-%Y")))
    } else {
        None
    }
}

fn duration_to_pretty_long_form(duration: Duration) -> String {
    const SECOND: u64 = 1;
    const MINUTE: u64 = 60;
    const HOUR: u64 = MINUTE * 60;
    const DAY: u64 = HOUR * 24;
    let mut secs = duration.as_secs();
    let mut builder: Vec<_> = vec![
        (DAY, "day"),
        (HOUR, "hour"),
        (MINUTE, "minute"),
        (SECOND, "second"),
    ]
    .into_iter()
    .filter_map(move |(unit, name)| {
        let count = secs / unit;
        if count > 0 {
            secs -= count * unit;
            if count > 1 {
                Some(format!("{} {}s", count, name))
            } else {
                Some(format!("{} {}", count, name))
            }
        } else {
            None
        }
    })
    .collect();
    let long_time = if let Some(last) = builder.pop() {
        let mut ret = builder.join(", ");
        if ret.is_empty() {
            last
        } else {
            ret.push_str(&format!(" and {}", last));
            ret
        }
    } else {
        "0 seconds".to_string()
    };
    format!("in approximately {}", long_time)
}
