#![warn(rust_2018_idioms)]
#![type_length_limit = "1483480"]

mod error;
mod providers;
mod request;
mod stats;
mod util;

use crate::error::TestError;
use crate::stats::{create_stats_channel, create_try_run_stats_channel, StatsMessage};

use bytes::BytesMut;
use ether::{Either, Either3};
use futures::{
    future::{self, join_all},
    sink::Sink,
    stream,
    sync::{
        mpsc::{self as futures_channel, Receiver as FCReceiver, Sender as FCSender},
        oneshot,
    },
    Async, Future, IntoFuture, Stream,
};
use hyper::{client::HttpConnector, Body, Client};
use hyper_tls::HttpsConnector;
use itertools::Itertools;
use mod_interval::ModInterval;
use native_tls::TlsConnector;
use serde_json as json;
use tokio::io::{read_to_end, write_all, AsyncRead, AsyncWrite};
use yansi::Paint;

use std::{
    borrow::Cow,
    cell::RefCell,
    cmp,
    collections::{BTreeMap, BTreeSet},
    convert::TryFrom,
    io::SeekFrom,
    mem,
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

struct Endpoints {
    // yaml index of the endpoint, (endpoint tags, builder)
    inner: Vec<(BTreeMap<String, String>, request::Builder, BTreeSet<String>)>,
    // provider name, yaml index of endpoints which provide the provider
    providers: BTreeMap<String, Vec<usize>>,
}

impl Endpoints {
    fn new() -> Self {
        Endpoints {
            inner: Vec::new(),
            providers: BTreeMap::new(),
        }
    }

    fn append(
        &mut self,
        endpoint_tags: BTreeMap<String, String>,
        builder: request::Builder,
        provides: BTreeSet<String>,
        required_providers: config::RequiredProviders,
    ) {
        let i = self.inner.len();
        let set = required_providers.unique_providers();
        self.inner.push((endpoint_tags, builder, set));
        for p in provides {
            self.providers.entry(p).or_default().push(i);
        }
    }

    fn build<F>(
        self,
        filter_fn: F,
        builder_ctx: &mut request::BuilderContext,
        response_providers: &BTreeSet<String>,
    ) -> Result<Vec<Box<dyn Future<Item = (), Error = TestError> + Send>>, TestError>
    where
        F: Fn(&BTreeMap<String, String>) -> bool,
    {
        let mut endpoints: BTreeMap<_, _> = self
            .inner
            .into_iter()
            .enumerate()
            .map(|(i, (tags, builder, required_providers))| {
                let included = filter_fn(&tags);
                (
                    i,
                    (included, builder.build(builder_ctx), required_providers),
                )
            })
            .collect();

        let mut providers = self.providers;
        let mut endpoints_needed_for_test = BTreeMap::new();

        let required_indices = RefCell::new(std::collections::VecDeque::new());
        let iter = (0..endpoints.len())
            .map(|i| (false, i))
            .chain(std::iter::from_fn(|| {
                required_indices.borrow_mut().pop_front().map(|i| (true, i))
            }));
        for (bypass_filter, i) in iter {
            if let Some((included, ..)) = endpoints.get(&i) {
                if *included || bypass_filter {
                    if let Some((_, ep, required_providers)) = endpoints.remove(&i) {
                        for request_provider in required_providers.intersection(response_providers)
                        {
                            if let Some(indices) = providers.remove(request_provider) {
                                required_indices.borrow_mut().extend(indices);
                            }
                        }
                        endpoints_needed_for_test.insert(i, (ep, bypass_filter));
                    }
                }
            } else if let Some((_, provides_needed)) = endpoints_needed_for_test.get_mut(&i) {
                *provides_needed = true;
            }
        }
        let ret = endpoints_needed_for_test
            .into_iter()
            .map(|(_, (mut ep, provides_needed))| {
                if !provides_needed {
                    ep.clear_provides();
                    let mut ran = false;
                    ep.add_start_stream(stream::poll_fn(move || {
                        if ran {
                            Ok(Async::Ready(None))
                        } else {
                            ran = true;
                            Ok(Async::Ready(Some(request::StreamItem::None)))
                        }
                    }));
                }
                ep.into_future()
            })
            .collect();
        Ok(ret)
    }
}

#[derive(Copy, Clone, Debug)]
pub enum RunOutputFormat {
    Human,
    Json,
}

impl RunOutputFormat {
    pub fn is_human(self) -> bool {
        match self {
            RunOutputFormat::Human => true,
            _ => false,
        }
    }
}

impl TryFrom<&str> for RunOutputFormat {
    type Error = ();

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "human" => Ok(RunOutputFormat::Human),
            "json" => Ok(RunOutputFormat::Json),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Debug)]
pub enum StatsFileFormat {
    // Html,
    Json,
    // None,
}

#[derive(Clone, Debug)]
pub enum TryRunFormat {
    Human,
    Json,
}

impl Default for TryRunFormat {
    fn default() -> Self {
        TryRunFormat::Human
    }
}

impl TryFrom<&str> for TryRunFormat {
    type Error = ();

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "human" => Ok(TryRunFormat::Human),
            "json" => Ok(TryRunFormat::Json),
            _ => Err(()),
        }
    }
}

#[derive(Debug)]
pub struct RunConfig {
    pub config_file: PathBuf,
    pub ctrlc_channel: futures_channel::UnboundedReceiver<()>,
    pub output_format: RunOutputFormat,
    pub results_dir: Option<PathBuf>,
    pub stats_file: PathBuf,
    pub stats_file_format: StatsFileFormat,
    pub watch_config_file: bool,
    pub start_at: Option<Duration>,
}

#[derive(Clone)]
pub enum TryFilter {
    Eq(String, String),
    Ne(String, String),
}

#[derive(Clone)]
pub struct TryConfig {
    pub config_file: PathBuf,
    pub loggers_on: bool,
    pub file: Option<String>,
    pub filters: Option<Vec<TryFilter>>,
    pub format: TryRunFormat,
    pub results_dir: Option<PathBuf>,
}

pub enum ExecConfig {
    Run(RunConfig),
    Try(TryConfig),
}

impl ExecConfig {
    fn get_config_file(&self) -> &PathBuf {
        match self {
            ExecConfig::Run(r) => &r.config_file,
            ExecConfig::Try(t) => &t.config_file,
        }
    }

    fn get_output_format(&self) -> RunOutputFormat {
        match self {
            ExecConfig::Run(r) => r.output_format,
            ExecConfig::Try(_) => RunOutputFormat::Human,
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub enum TestEndReason {
    Completed,
    CtrlC,
    KilledByLogger,
    ProviderEnded,
}

type TestEndedChannel = (
    FCSender<Result<TestEndReason, TestError>>,
    FCReceiver<Result<TestEndReason, TestError>>,
);

type LoadPatternUpdates = Option<(
    Vec<mod_interval::LoadUpdateChannel>,
    channel::Receiver<Duration>,
)>;

pub fn create_run<Se, So, Sef, Sof>(
    exec_config: ExecConfig,
    stdout: Sof,
    stderr: Sef,
) -> impl Future<Item = (), Error = ()>
where
    Se: AsyncWrite + Send + Sync + 'static,
    So: AsyncWrite + Send + Sync + 'static,
    Sef: Fn() -> Se + Clone + Send + Sync + 'static,
    Sof: Fn() -> So + Clone + Send + Sync + 'static,
{
    let stderr2 = stderr();
    let output_format = exec_config.get_output_format();
    let config_file = exec_config.get_config_file().clone();
    tokio::fs::File::open(config_file.clone())
        .then(move |file| {
            match file {
                Ok(file) => {
                    let a = read_to_end(file, Vec::new())
                        .map_err(|e| TestError::CannotOpenFile(config_file, e.into()));
                    Either::A(a)
                }
                Err(_) => {
                    let b = Err(TestError::InvalidConfigFilePath(config_file))
                        .into_future();
                    Either::B(b)
                }
            }
        })
        .and_then(move |(file, config_bytes)| {
            let env_vars = std::env::vars_os()
                .map(|(k, v)| {
                    (
                        k.to_string_lossy().into(),
                        v.to_string_lossy().into(),
                    )
                })
                .collect();
            let config = match config::LoadTest::from_config(&config_bytes, exec_config.get_config_file(), &env_vars) {
                Ok(c) => c,
                Err(e) => return Either3::B(Err(e.into()).into_future()),
            };
            let (test_ended_tx, test_ended_rx) = futures_channel::channel(0);
            let work = match exec_config {
                ExecConfig::Try(t) => create_try_run_future(
                    config,
                    t,
                    (test_ended_tx.clone(), test_ended_rx),
                    stdout,
                    stderr,
                )
                .map(Either::A),
                ExecConfig::Run(r) => {
                    let load_pattern_updates = if r.watch_config_file {
                        let lpu = create_load_watcher(&config, file, env_vars);
                        Some(lpu)
                    } else {
                        None
                    };
                    create_load_test_future(
                        config,
                        r,
                        (test_ended_tx.clone(), test_ended_rx),
                        stdout,
                        stderr,
                        load_pattern_updates,
                    )
                    .map(Either::B)
                },
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
                    let msg = match output_format {
                        RunOutputFormat::Human => {
                            format!("\n{} {}\n", Paint::red("Fatal error").bold(), e)
                        }
                        RunOutputFormat::Json => {
                            let json = json::json!({"type": "fatal", "msg": format!("{}", e)});
                            format!("{}\n", json)
                        }
                    };
                    let a = write_all(stderr2, msg);
                    Either::A(a)
                }
                Ok(TestEndReason::KilledByLogger) => {
                    let msg = match output_format {
                        RunOutputFormat::Human => {
                            format!(
                                "\n{}\n",
                                Paint::yellow("Test killed early by logger").bold()
                            )
                        }
                        RunOutputFormat::Json => {
                            "{\"type\":\"end\",\"msg\":\"Test killed early by logger\"}\n".to_string()
                        }
                    };
                    let a = write_all(stderr2, msg);
                    Either::A(a)
                }
                Ok(TestEndReason::CtrlC) => {
                    let msg = match output_format {
                        RunOutputFormat::Human => {
                            format!(
                                "\n{}\n",
                                Paint::yellow("Test killed early by Ctrl-c").bold()
                            )
                        }
                        RunOutputFormat::Json => {
                            "{\"type\":\"end\",\"msg\":\"Test killed early by Ctrl-c\"}\n".to_string()
                        }
                    };
                    let a = write_all(stderr2, msg);
                    Either::A(a)
                }
                Ok(TestEndReason::ProviderEnded) => {
                    let msg = match output_format {
                        RunOutputFormat::Human => {
                            format!(
                                "\n{}\n",
                                Paint::yellow("Test ended early because one or more providers ended")
                            )
                        }
                        RunOutputFormat::Json => {
                            "{\"type\":\"end\",\"msg\":\"Test ended early because one or more providers ended\"}\n".to_string()
                        }
                    };
                    let a = write_all(stderr2, msg);
                    Either::A(a)
                }
                _ => Either::B(Ok::<_, ()>(()).into_future()),
            };
            f.map_a(|a| a.then(|_| Ok(())))
                .then(move |_| r)
                .map(|_| {
                    // FIXME: the event loop doesn't immediately shutdown on ctrl c 
                    std::process::exit(0);
                })
                .map_err(|_| ())
        })
}

fn create_load_watcher(
    config: &config::LoadTest,
    mut file: tokio::fs::File,
    env_vars: BTreeMap<String, String>,
) -> (
    Vec<mod_interval::LoadUpdateChannel>,
    channel::Receiver<Duration>,
) {
    let (senders, receivers): (Vec<_>, Vec<_>) = (0..config.endpoints.len())
        .map(|_| channel::channel(config::Limit::auto()))
        .unzip();
    let (duration_sender, duration_receiver) = channel::channel(config::Limit::auto());
    let mut interval = tokio::timer::Interval::new_interval(Duration::from_millis(1000));
    let mut file_seeked = false;
    let mut interval_triggered = false;
    let mut modified = None;
    let mut last_modified = None;
    let mut file_bytes = BytesMut::with_capacity(4096);
    let f = future::poll_fn(move || {
        if senders.iter().all(channel::Sender::no_receivers) {
            return Ok(Async::Ready(()));
        }
        let mut should_reset = false;
        'outer: loop {
            if should_reset {
                interval_triggered = false;
                modified = None;
                file_seeked = false;
                file_bytes.clear();
            }
            should_reset = true;
            if !interval_triggered {
                match interval.poll() {
                    Ok(Async::Ready(Some(_))) => {
                        interval_triggered = true;
                    }
                    Ok(Async::NotReady) => return Ok(Async::NotReady),
                    Ok(Async::Ready(None)) => return Ok(Async::Ready(())),
                    Err(_) => return Err(()),
                }
            }
            if !file_seeked {
                match file.poll_seek(SeekFrom::Start(0)) {
                    Ok(Async::NotReady) => return Ok(Async::NotReady),
                    Ok(Async::Ready(_)) => file_seeked = true,
                    Err(_) => continue,
                }
            }
            let modified_time = if let Some(m) = modified {
                m
            } else {
                match file.poll_metadata() {
                    Ok(Async::Ready(md)) => {
                        let m = match md.modified() {
                            Ok(m) => m,
                            Err(_) => continue,
                        };
                        modified = Some(m);
                        m
                    }
                    Ok(Async::NotReady) => return Ok(Async::NotReady),
                    Err(_) => continue,
                }
            };
            match last_modified {
                Some(time) if modified_time > time => {
                    loop {
                        file_bytes.reserve(1024);
                        match file.read_buf(&mut file_bytes) {
                            Ok(Async::Ready(n)) if n == 0 => break,
                            Ok(Async::Ready(_)) => (),
                            Ok(Async::NotReady) => return Ok(Async::NotReady),
                            Err(_) => continue,
                        }
                    }
                    last_modified = Some(modified_time);
                    let config = match config::LoadTest::from_config(
                        &file_bytes[..],
                        &Default::default(),
                        &env_vars,
                    ) {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    let transition_time = config.config.general.watch_transition_time;
                    let mut duration = Duration::new(0, 0);
                    for (endpoint, sender) in config.endpoints.into_iter().zip(senders.iter()) {
                        if let Some(peak_load) = endpoint.peak_load {
                            let load_pattern = match endpoint.load_pattern {
                                Some(l) => l,
                                None => continue 'outer,
                            };
                            duration = cmp::max(duration, load_pattern.duration());
                            let builder = load_pattern.builder();
                            let ls = mod_interval::LinearScaling::new(builder, &peak_load, None);
                            if !sender.no_receivers() {
                                sender.force_send((ls, transition_time));
                            }
                        }
                    }
                    duration_sender.force_send(duration);
                }
                None => {
                    last_modified = Some(modified_time);
                }
                _ => (),
            }
        }
    });
    tokio::spawn(f);
    (receivers, duration_receiver)
}

fn create_try_run_future<Se, So, Sef, Sof>(
    mut config: config::LoadTest,
    try_config: TryConfig,
    test_ended: TestEndedChannel,
    stdout: Sof,
    stderr: Sef,
) -> Result<impl Future<Item = TestEndReason, Error = TestError>, TestError>
where
    Se: AsyncWrite + Send + Sync + 'static,
    So: AsyncWrite + Send + Sync + 'static,
    Sef: Fn() -> Se + Clone + Send + Sync + 'static,
    Sof: Fn() -> So + Clone + Send + Sync + 'static,
{
    let (test_ended_tx, test_ended_rx) = test_ended;
    let test_ended_rx = test_ended_rx
        .into_future()
        .then(|v| match v {
            Ok((Some(r), _)) => r,
            _ => unreachable!("test_ended should not error at this point"),
        })
        .shared();

    let select = if let TryRunFormat::Human = try_config.format {
        "`\
         Request\n\
         ========================================\n\
         ${request['start-line']}\n\
         ${join(request.headers, '\n', ': ')}\n\
         ${if(request.body != '', '\n${request.body}\n', '')}\n\
         Response (RTT: ${stats.rtt}ms)\n\
         ========================================\n\
         ${response['start-line']}\n\
         ${join(response.headers, '\n', ': ')}\n\
         ${if(response.body != '', '\n${response.body}', '')}\n\n`"
    } else {
        r#"{
            "request": {
                "start-line": "request['start-line']",
                "headers": "request.headers",
                "body": "request.body"
            },
            "response": {
                "start-line": "response['start-line']",
                "headers": "response.headers",
                "body": "response.body"
            },
            "stats": {
                "RTT": "stats.rtt"
            }
        })"#
    };
    let to = try_config.file.unwrap_or_else(|| "stderr".into());
    let logger = config::LoggerPreProcessed::from_str(&select, &to).unwrap();
    if !try_config.loggers_on {
        config.clear_loggers();
    }
    config.add_logger("try_run".into(), logger)?;

    let config_config = config.config;

    // build and register the providers
    let (providers, response_providers) = get_providers_from_config(
        config.providers,
        config_config.general.auto_buffer_start_size,
        &test_ended_tx,
        &try_config.config_file,
    )?;

    let filters: Vec<_> = try_config
        .filters
        .unwrap_or_default()
        .into_iter()
        .map(|try_filter| {
            let (is_eq, key, right) = match try_filter {
                TryFilter::Eq(key, right) => (true, key, right),
                TryFilter::Ne(key, right) => (false, key, right),
            };
            let right = right.split('*').map(regex::escape).join(".*?");
            let right = format!("^{}$", right);
            (
                is_eq,
                key,
                regex::Regex::new(&right).expect("filter should be a valid regex"),
            )
        })
        .collect();
    let filter_fn = move |tags: &BTreeMap<String, String>| -> bool {
        filters.is_empty()
            || filters.iter().any(|(is_eq, key, regex)| {
                let check = tags
                    .get(key)
                    .map(|left| regex.is_match(left))
                    .unwrap_or(false);
                if *is_eq {
                    check
                } else {
                    !check
                }
            })
    };

    // create the loggers
    let loggers = get_loggers_from_config(
        config.loggers,
        try_config.results_dir.as_ref(),
        &test_ended_tx,
        stdout,
        stderr.clone(),
    );

    let mut endpoints = Endpoints::new();

    for mut endpoint in config.endpoints.into_iter() {
        let required_providers = mem::replace(&mut endpoint.required_providers, Default::default());

        let provides_set = endpoint
            .provides
            .iter_mut()
            .filter_map(|(k, s)| {
                s.set_send_behavior(config::EndpointProvidesSendOptions::Block);
                if required_providers.contains(k) {
                    None
                } else {
                    Some(k.clone())
                }
            })
            .collect::<BTreeSet<_>>();
        endpoint.on_demand = true;

        let static_tags = endpoint
            .tags
            .iter()
            .filter_map(|(k, v)| {
                if v.is_simple() {
                    let r = v
                        .evaluate(Cow::Owned(json::Value::Null), None)
                        .map(|v| (k.clone(), v));
                    Some(r)
                } else {
                    None
                }
            })
            .collect::<Result<_, _>>()?;

        let builder = request::Builder::new(endpoint, None);
        endpoints.append(static_tags, builder, provides_set, required_providers);
    }

    let client = create_http_client(config_config.client.keepalive)?;

    let (stats_tx, stats_rx) = create_try_run_stats_channel(test_ended_rx.clone(), stderr);
    let (tx, stats_done) = oneshot::channel::<()>();
    tokio::spawn(stats_rx.then(move |_| {
        drop(tx);
        Ok(())
    }));

    let mut builder_ctx = request::BuilderContext {
        config: config_config,
        config_path: try_config.config_file,
        client: Arc::new(client),
        loggers,
        providers,
        stats_tx,
    };

    let endpoint_calls = endpoints.build(filter_fn, &mut builder_ctx, &response_providers)?;

    let endpoint_calls = join_all(endpoint_calls)
        .map(|_| TestEndReason::Completed)
        .then(move |r| test_ended_tx.send(r.clone()).then(|_| r))
        .select(test_ended_rx.map(|r| *r).map_err(|e| (&*e).clone()))
        .map(|r| r.0)
        .map_err(|e| e.0)
        .then(move |r| stats_done.then(move |_| r));

    Ok(endpoint_calls)
}

fn create_load_test_future<Se, So, Sef, Sof>(
    config: config::LoadTest,
    run_config: RunConfig,
    test_ended: TestEndedChannel,
    stdout: Sof,
    stderr: Sef,
    load_pattern_updates: LoadPatternUpdates,
) -> Result<impl Future<Item = TestEndReason, Error = TestError>, TestError>
where
    Se: AsyncWrite + Send + Sync + 'static,
    So: AsyncWrite + Send + Sync + 'static,
    Sef: Fn() -> Se + Clone + Send + Sync + 'static,
    Sof: Fn() -> So + Clone + Send + Sync + 'static,
{
    config.ok_for_loadtest()?;

    let (test_ended_tx, test_ended_rx) = test_ended;
    let test_ended_rx = test_ended_rx
        .into_future()
        .then(|v| match v {
            Ok((Some(r), _)) => r,
            _ => unreachable!("test_ended should not error at this point"),
        })
        .shared();

    let mut duration = config.get_duration();
    if let Some(t) = run_config.start_at {
        duration -= t;
    }

    let config_config = config.config;

    // build and register the providers
    let (providers, _) = get_providers_from_config(
        config.providers,
        config_config.general.auto_buffer_start_size,
        &test_ended_tx,
        &run_config.config_file,
    )?;

    // create the loggers
    let loggers = get_loggers_from_config(
        config.loggers,
        run_config.results_dir.as_ref(),
        &test_ended_tx,
        stdout.clone(),
        stderr,
    );

    // create the endpoints
    let (endpoints_iter, mut duration_updater) = if let Some((receivers, du)) = load_pattern_updates
    {
        let ei = Either::A(
            config
                .endpoints
                .into_iter()
                .zip_eq(receivers.into_iter().map(Some)),
        );
        (ei, Some(du))
    } else {
        let ei = Either::B(config.endpoints.into_iter().map(|ep| (ep, None)));
        (ei, None)
    };
    let builders: Vec<_> = endpoints_iter
        .map(|(mut endpoint, receiver)| {
            let mut mod_interval: Option<
                Box<dyn Stream<Item = Instant, Error = TestError> + Send>,
            > = None;

            if let (Some(peak_load), Some(load_pattern)) =
                (endpoint.peak_load.as_ref(), endpoint.load_pattern.take())
            {
                mod_interval = Some(Box::new(ModInterval::new(
                    load_pattern,
                    peak_load,
                    receiver,
                    run_config.start_at,
                )));
            }

            request::Builder::new(endpoint, mod_interval)
        })
        .collect();

    let client = create_http_client(config_config.client.keepalive)?;

    let (stats_tx, stats_rx) = create_stats_channel(
        test_ended_rx.clone(),
        test_ended_tx.clone(),
        &config_config.general,
        &providers,
        stdout,
        &run_config,
    )?;
    let (tx, stats_done) = oneshot::channel::<()>();
    tokio::spawn(stats_rx.then(move |_| {
        drop(tx);
        Ok(())
    }));

    let mut builder_ctx = request::BuilderContext {
        config: config_config,
        config_path: run_config.config_file,
        client: Arc::new(client),
        loggers,
        providers,
        stats_tx: stats_tx.clone(),
    };

    let endpoint_calls = builders
        .into_iter()
        .map(move |builder| builder.build(&mut builder_ctx).into_future());

    let mut ctrlc_channel = run_config.ctrlc_channel;
    let test_ended_tx2 = test_ended_tx.clone();
    let endpoint_calls = stats_tx
        .send(StatsMessage::Start(duration))
        .map_err(|_| unreachable!("Error sending test start signal"))
        .then(move |r| match r {
            Ok(stats_tx) => {
                let test_start = Instant::now();
                let test_end = test_start + duration;
                let mut test_end_delay = tokio::timer::Delay::new(test_end);
                let a = join_all(endpoint_calls)
                    .map(move |_r| {
                        if Instant::now() >= test_end {
                            TestEndReason::Completed
                        } else {
                            TestEndReason::ProviderEnded
                        }
                    })
                    .select(future::poll_fn(move || {
                        if let Async::Ready(_) =
                            test_end_delay.poll().map_err::<TestError, _>(Into::into)?
                        {
                            return Ok(Async::Ready(TestEndReason::Completed));
                        }
                        if let Ok(Async::Ready(_)) = ctrlc_channel.poll() {
                            return Ok(Async::Ready(TestEndReason::CtrlC));
                        }
                        if let Some(duration_updater2) = &mut duration_updater {
                            let mut duration = None;
                            loop {
                                match duration_updater2.poll() {
                                    Ok(Async::Ready(Some(d))) => duration = Some(d),
                                    Ok(Async::Ready(None)) | Err(_) => {
                                        duration_updater = None;
                                        break;
                                    }
                                    Ok(Async::NotReady) => break,
                                }
                            }
                            if let Some(duration) = duration {
                                test_end_delay.reset(test_start + duration);
                                if stats_tx
                                    .unbounded_send(StatsMessage::Start(duration))
                                    .is_err()
                                {
                                    duration_updater = None;
                                }
                            }
                        }
                        Ok(Async::NotReady)
                    }))
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

pub(crate) fn create_http_client(
    keepalive: Duration,
) -> Result<
    Client<HttpsConnector<HttpConnector<hyper::client::connect::dns::TokioThreadpoolGaiResolver>>>,
    TestError,
> {
    let mut http = HttpConnector::new_with_tokio_threadpool_resolver();
    http.set_keepalive(Some(keepalive));
    http.set_reuse_address(true);
    http.enforce_http(false);
    let https = HttpsConnector::from((http, TlsConnector::new()?));
    Ok(Client::builder().set_host(false).build::<_, Body>(https))
}

type ProvidersResult = Result<(BTreeMap<String, providers::Provider>, BTreeSet<String>), TestError>;

fn get_providers_from_config(
    config_providers: BTreeMap<String, config::Provider>,
    auto_size: usize,
    test_ended_tx: &FCSender<Result<TestEndReason, TestError>>,
    config_path: &PathBuf,
) -> ProvidersResult {
    let mut providers = BTreeMap::new();
    let mut response_providers = BTreeSet::new();
    let default_buffer_size = config::default_auto_buffer_start_size();
    for (name, template) in config_providers {
        let provider = match template {
            config::Provider::File(mut template) => {
                // the auto_buffer_start_size is not the default
                if auto_size != default_buffer_size {
                    if let config::Limit::Auto(limit) = &template.buffer {
                        limit.store(auto_size, Ordering::Relaxed);
                    }
                }
                util::tweak_path(&mut template.path, config_path);
                providers::file(template, test_ended_tx.clone())?
            }
            config::Provider::Range(range) => providers::range(range),
            config::Provider::Response(template) => {
                // the auto_buffer_start_size is not the default
                if auto_size != default_buffer_size {
                    if let config::Limit::Auto(limit) = &template.buffer {
                        limit.store(auto_size, Ordering::Relaxed);
                    }
                }
                response_providers.insert(name.clone());
                providers::response(template)
            }
            config::Provider::List(values) => providers::literals(values),
        };
        providers.insert(name, provider);
    }
    Ok((providers, response_providers))
}

fn get_loggers_from_config<Se, So, Sef, Sof>(
    config_loggers: BTreeMap<String, config::Logger>,
    results_dir: Option<&PathBuf>,
    test_ended_tx: &FCSender<Result<TestEndReason, TestError>>,
    stdout: Sof,
    stderr: Sef,
) -> BTreeMap<String, channel::Sender<json::Value>>
where
    Se: AsyncWrite + Send + Sync + 'static,
    So: AsyncWrite + Send + Sync + 'static,
    Sef: Fn() -> Se,
    Sof: Fn() -> So,
{
    config_loggers
        .into_iter()
        .map(|(name, mut template)| {
            let to = mem::replace(&mut template.to, Default::default());
            let writer_future = match to.as_str() {
                "stderr" => Either::A(future::ok(Either3::A(stderr()))),
                "stdout" => Either::A(future::ok(Either3::B(stdout()))),
                _ => {
                    let mut file_path = if let Some(results_dir) = results_dir {
                        results_dir.clone()
                    } else {
                        PathBuf::new()
                    };
                    file_path.push(to);
                    let name2 = name.clone();
                    let f = tokio::fs::File::create(file_path)
                        .map(Either3::C)
                        .map_err(|e| TestError::CannotCreateLoggerFile(name2, e.into()));
                    Either::B(f)
                }
            };
            let sender =
                providers::logger(name.clone(), template, test_ended_tx.clone(), writer_future);
            (name, sender)
        })
        .collect()
}
