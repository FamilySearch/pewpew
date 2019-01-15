use crate::channel;
use crate::config;
use crate::providers;
use crate::request;
use crate::stats::{create_stats_channel, StatsMessage};
use chrono::{Duration as ChronoDuration, Local};
use futures::{
    future::{join_all, lazy, Shared},
    stream::StreamFuture,
    sync::{
        mpsc::{self as futures_channel, Receiver as FCReceiver},
        oneshot,
    },
};
pub use hyper::{client::HttpConnector, Body, Client};
use hyper_tls::HttpsConnector;
use native_tls::TlsConnector;
use serde_json as json;
use tokio::{prelude::*, timer};

use std::{
    cmp,
    collections::BTreeMap,
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

pub struct LoadTest {
    pub config: config::Config,
    // the http client
    pub client: Arc<Client<HttpsConnector<HttpConnector>>>,
    // how long the test will run for (can go longer due to waiting for responses)
    duration: Duration,
    // a list of futures for the endpoint tasks to run
    endpoint_calls: Vec<Box<dyn Future<Item = (), Error = ()> + Send>>,
    // a mapping of names to their prospective static (single value) providers
    pub static_providers: BTreeMap<String, json::Value>,
    // a mapping of names to their prospective providers
    pub providers: Arc<BTreeMap<String, providers::Kind>>,
    // a mapping of names to their prospective loggers
    pub loggers: BTreeMap<String, (channel::Sender<json::Value>, Option<config::Select>)>,
    // channel that receives and aggregates stats for the test
    pub stats_tx: futures_channel::UnboundedSender<StatsMessage>,
    // a trigger used to signal when the endpoints tasks finish (including sending their stats)
    test_ended_tx: oneshot::Sender<()>,
    // channel that receives a message if the test is killed
    pub test_killed_rx: Shared<StreamFuture<FCReceiver<()>>>,
    pub test_timeout: Shared<Box<dyn Future<Item = (), Error = ()> + Send>>,
}

impl LoadTest {
    pub fn new(config: config::LoadTest, config_path: PathBuf) -> Self {
        let mut providers = BTreeMap::new();
        let mut static_providers = BTreeMap::new();

        let (test_ended_tx, test_ended_rx) = oneshot::channel::<()>();
        let test_ended_rx = test_ended_rx.into_future().shared();

        let (test_killed_tx, test_killed_rx) = futures_channel::channel::<()>(0);
        let test_killed_rx = test_killed_rx.into_future().shared();

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
                    providers::file(template, test_ended_rx, &config_path)
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

        let loggers = config
            .loggers
            .into_iter()
            .map(|(name, mut template)| {
                let test_ended_rx = test_ended_rx.clone();
                let select = template.select.take().map(eppp_to_select);
                (
                    name,
                    (
                        providers::logger(
                            template,
                            test_ended_rx,
                            test_killed_tx.clone(),
                            &config_path,
                        ),
                        select,
                    ),
                )
            })
            .collect();

        let global_load_pattern = config.load_pattern;
        let mut duration = Duration::new(0, 0);
        let mut builders = Vec::new();
        // create the endpoints
        for endpoint in config.endpoints {
            let mut mod_interval = None;
            let to_select_values = |v: Vec<(String, config::EndpointProvidesPreProcessed)>| -> Vec<(String, config::Select)> {
                v.into_iter().map(|(s, eppp)| (s, eppp_to_select(eppp)))
                    .collect()
            };
            let provides = to_select_values(endpoint.provides);
            if let Some(peak_load) = endpoint.peak_load {
                let load_pattern = endpoint
                    .load_pattern
                    .as_ref()
                    .unwrap_or_else(|| global_load_pattern.as_ref().expect("missing load_pattern"));
                let start: Box<dyn Stream<Item = Instant, Error = timer::Error> + Send> =
                    Box::new(stream::empty::<Instant, timer::Error>());
                let mod_interval2 = load_pattern.iter().fold(start, |prev, lp| match lp {
                    config::LoadPattern::Linear(lb) => Box::new(prev.chain(lb.build(&peak_load))),
                });
                mod_interval = Some(mod_interval2);
                let duration2 = load_pattern
                    .iter()
                    .fold(Duration::new(0, 0), |left, right| left + right.duration());
                duration = cmp::max(duration, duration2);
            } else if provides.is_empty() {
                panic!("endpoint without peak_load must have `provides`");
            } else if provides
                .iter()
                .all(|(_, p)| p.get_send_behavior().is_if_not_full())
            {
                panic!("endpoint without peak_load cannot have all the `provides` send behavior be `if_not_full`");
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
                .logs(to_select_values(endpoint.logs));
            builders.push(builder);
        }
        let test_ended_rx2 = test_ended_rx.clone();
        let test_timeout: Box<dyn Future<Item = (), Error = ()> + Send> =
            Box::new(lazy(move || {
                timer::Delay::new(Instant::now() + duration)
                    .select(test_ended_rx2.then(|_| Ok(())))
                    .then(|_| Err::<(), ()>(()))
            }));

        let test_timeout = test_timeout.shared();

        let client = {
            let mut http = HttpConnector::new(4);
            http.set_keepalive(Some(config.config.client.keepalive));
            http.set_reuse_address(true);
            http.enforce_http(false);
            let https = HttpsConnector::from((http, TlsConnector::new().unwrap()));
            Client::builder().build::<_, Body>(https)
        };

        let (stats_tx, stats_rx_done) =
            create_stats_channel(test_ended_rx.clone(), &config.config.general);
        tokio::spawn(stats_rx_done);

        let mut load_test = LoadTest {
            config: config.config,
            client: Arc::new(client),
            duration,
            endpoint_calls: Vec::new(),
            loggers,
            providers,
            static_providers,
            stats_tx,
            test_killed_rx,
            test_ended_tx,
            test_timeout,
        };

        for (i, builder) in builders.into_iter().enumerate() {
            let endpoint = builder.build(&mut load_test, i);
            load_test.endpoint_calls.push(Box::new(endpoint));
        }

        load_test
    }

    pub fn run(self) -> impl Future<Item = (), Error = ()> {
        let test_ended = self.test_ended_tx;
        // drop this client reference otherwise the event loop will not close
        drop(self.client);
        let test_end_message = duration_till_end_to_pretty_string(self.duration);
        tokio::spawn(
            self.stats_tx
                .send(StatsMessage::EndTime(Instant::now() + self.duration))
                .then(|_| Ok(())),
        );
        eprint!("{}", format!("Starting load test. {}\n", test_end_message));
        join_all(self.endpoint_calls)
            .map_err(|_| unreachable!("endpoint errors should not propagate this far"))
            .and_then(move |_| test_ended.send(()))
            .map_err(|_| unreachable!("errors should not propagate this far"))
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
