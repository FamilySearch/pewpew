use chrono::{Duration as ChronoDuration, Local};
use crate::config::{Config, LoadPattern, Provider, StaticListProvider, StaticProvider};
use crate::providers;
use crate::request;
use crate::stats::{create_stats_channel, ResponseStat};
use futures::{
    future::{join_all, lazy, Shared},
    sync::{
        mpsc as futures_channel,
        oneshot,
    }
};
pub use hyper::{
    Body,
    client::HttpConnector,
    Client,
};
use hyper_tls::HttpsConnector;
use native_tls::TlsConnector;
use tokio::{
    prelude::*,
    timer,
};

use std::{
    cmp,
    collections::BTreeMap,
    sync::{Arc},
    time::{Duration, Instant},
};

pub struct LoadTest {
    // the http client
    pub client: Arc<Client<HttpsConnector<HttpConnector>>>,
    // how long the test will run for (can go longer due to waiting for responses)
    duration: Duration,
    // a list of futures for the endpoint tasks to run
    endpoint_calls: Vec<Box<dyn Future<Item = (), Error = ()> + Send>>,
    // a count of the number of requests in progress (currently not used)
    pub open_requests: Arc<()>,
    // a mapping of names to their prospective providers
    pub providers: BTreeMap<String, providers::Kind>,
    // channel that receives and aggregates stats for the test
    pub stats_tx: futures_channel::UnboundedSender<ResponseStat>,
    // a trigger used to signal when the endpoints tasks finish (including sending their stats)
    test_ended_tx: oneshot::Sender<()>,
    pub test_timeout: Shared<Box<dyn Future<Item=(), Error=()> + Send>>,
}

impl LoadTest
{
    pub fn new (config: Config) -> Self {
        let mut providers = BTreeMap::new();

        let (test_ended_tx, test_ended_rx) = oneshot::channel::<()>();
        let test_ended_rx = test_ended_rx.shared();

        // build and register the providers
        for (name, template) in config.providers {
            let test_ended_rx = test_ended_rx.clone();
            let provider = match template {
                Provider::File(template) =>
                    providers::file(template, test_ended_rx),
                Provider::Peek(template) =>
                    providers::peek(template.limit, test_ended_rx),
                Provider::Response(template) =>
                    providers::response(template, test_ended_rx),
                Provider::Static(StaticProvider::Explicit(template)) =>
                    providers::literals(vec!(template.value), template.transform, test_ended_rx),
                Provider::Static(StaticProvider::Implicit(value)) =>
                    providers::literals(vec!(value), None, test_ended_rx),
                Provider::StaticList(StaticListProvider::Explicit(template)) =>
                    providers::literals(template.values, template.transform, test_ended_rx),
                Provider::StaticList(StaticListProvider::Implicit(values)) =>
                    providers::literals(values, None, test_ended_rx),
            };
            providers.insert(name, provider);
        }

        let global_load_pattern = config.load_pattern;
        let mut duration = Duration::new(0, 0);
        let mut builders = Vec::new();
        // create the endpoints
        for endpoint in config.endpoints {
            let mut mod_interval = None;
            if let Some(peak_load) = endpoint.peak_load {
                let load_pattern = endpoint.load_pattern.as_ref()
                    .unwrap_or_else(|| global_load_pattern.as_ref().expect("missing load_pattern"));
                let start: Box<dyn Stream<Item=Instant, Error=timer::Error> + Send> = Box::new(stream::empty::<Instant, timer::Error>());
                let mod_interval2 = load_pattern.iter()
                    .fold(start, |prev, lp| {
                        match lp {
                            LoadPattern::Linear(lb) => Box::new(prev.chain(lb.build(&peak_load)))
                        }
                    });
                mod_interval = Some(mod_interval2);
                let duration2 = load_pattern.iter().fold(Duration::new(0, 0), |left, right| {
                    left + right.duration()
                });
                duration = cmp::max(duration, duration2);
            } else if endpoint.provides.is_empty() {
                panic!("endpoint without peak_load must have `provides`");
            } else if endpoint.provides.iter().all(|(_, p)| p.skip_if_full) {
                panic!("endpoint without peak_load cannot have all the `provides` be `skip_if_full`");
            }
            let builder = request::Builder::new(endpoint.url, mod_interval)
                .body(endpoint.body)
                .stats_id(endpoint.stats_id)
                .method(endpoint.method)
                .headers(endpoint.headers)
                .provides(endpoint.provides);
            builders.push(builder);
        }

        let test_timeout: Box<dyn Future<Item=(), Error=()> + Send> = Box::new(lazy(move || {
            timer::Delay::new(Instant::now() + duration)
                    .then(|_| Err::<(), ()>(()))
        }));

        let test_timeout = test_timeout.shared();

        let client = {
            let mut http = HttpConnector::new(4);
            http.set_keepalive(Some(Duration::from_secs(90)));
            http.set_reuse_address(true);
            http.enforce_http(false);
            let https = HttpsConnector::from((http, TlsConnector::new().unwrap()));
            Client::builder().build::<_, Body>(https)
        };

        let (stats_tx, stats_rx_done) = create_stats_channel(test_ended_rx);
        tokio::spawn(stats_rx_done);

        let mut load_test = LoadTest {
            client: Arc::new(client),
            duration,
            endpoint_calls: Vec::new(),
            open_requests: Arc::new(()),
            providers,
            stats_tx,
            test_ended_tx,
            test_timeout: test_timeout,
        };

        for (i, builder) in builders.into_iter().enumerate() {
            let endpoint = builder.build(&mut load_test, i);
            load_test.endpoint_calls.push(Box::new(endpoint));
        }

        load_test
    }

    pub fn run (self) -> impl Future<Item=(), Error=()> {
        let test_ended = self.test_ended_tx;
        // drop this client reference otherwise the event loop will not close
        drop(self.client);
        let pretty_time = duration_to_pretty_string(self.duration);
        eprint!("{}", format!("Starting load test. Test will conclude {}\n", pretty_time));
        join_all(self.endpoint_calls)
            .map_err(|_| unreachable!("endpoint errors should not propagate this far"))
            .and_then(move |_| test_ended.send(()))
            .map_err(|_| unreachable!("errors should not propagate this far"))
    }
}

fn duration_to_pretty_string (duration: Duration) -> String {
    if let Ok(duration) = ChronoDuration::from_std(duration) {
        let now = Local::now();
        let end = now + duration;
        format!("around {}", end.format("%T %-e-%b-%Y"))
    } else {
        const SECOND: u64 = 1;
        const MINUTE: u64 = 60;
        const HOUR: u64 = MINUTE * 60;
        const DAY: u64 = HOUR * 24;
        let mut secs = duration.as_secs();
        let mut builder: Vec<_> = vec!((DAY, "day"), (HOUR, "hour"), (MINUTE, "minute"), (SECOND, "second")).into_iter()
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
}