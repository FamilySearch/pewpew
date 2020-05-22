#![warn(rust_2018_idioms)]
#![type_length_limit = "1550232"]
#![feature(drain_filter)]

mod error;
mod line_writer;
mod providers;
mod request;
mod stats;
mod util;

use crate::error::TestError;
use crate::stats::{create_stats_channel, create_try_run_stats_channel, StatsMessage};

use ether::Either;
use futures::{
    channel::mpsc::{Sender as FCSender, UnboundedReceiver as FCUnboundedReceiver},
    future::{self, try_join_all},
    sink::SinkExt,
    FutureExt, Stream, StreamExt,
};
use hyper::{client::HttpConnector, Body, Client};
use hyper_tls::HttpsConnector;
use itertools::Itertools;
use line_writer::{blocking_writer, MsgType};
use mod_interval::{ModInterval, PerX};
use native_tls::TlsConnector;
use serde_json as json;
use tokio::{sync::broadcast, task::spawn_blocking};
use yansi::Paint;

use std::{
    borrow::Cow,
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    convert::TryFrom,
    fs::File,
    future::Future,
    io::{Error as IOError, ErrorKind as IOErrorKind, Read, Seek, SeekFrom, Write},
    mem,
    path::PathBuf,
    pin::Pin,
    sync::{atomic::Ordering, Arc},
    task::Poll,
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
    ) -> Result<Vec<impl Future<Output = Result<(), TestError>> + Send>, TestError>
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
                    ep.add_start_stream(future::ready(Ok(request::StreamItem::None)).into_stream());
                }
                ep.into_future()
            })
            .collect::<Vec<_>>();
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

#[derive(Clone, Debug)]
pub struct RunConfig {
    pub config_file: PathBuf,
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
    TestUpdate,
}

type TestEndedChannel = (
    broadcast::Sender<Result<TestEndReason, TestError>>,
    broadcast::Receiver<Result<TestEndReason, TestError>>,
);

async fn _create_run(
    exec_config: ExecConfig,
    mut ctrlc_channel: FCUnboundedReceiver<()>,
    stdout: FCSender<MsgType>,
    stderr: FCSender<MsgType>,
    test_ended_tx: broadcast::Sender<Result<TestEndReason, TestError>>,
    mut test_ended_rx: broadcast::Receiver<Result<TestEndReason, TestError>>,
) -> Result<TestEndReason, TestError> {
    let config_file = exec_config.get_config_file().clone();
    let config_file2 = config_file.clone();
    let (file, config_bytes) = spawn_blocking(|| {
        let mut file = File::open(config_file.clone())
            .map_err(|_| TestError::InvalidConfigFilePath(config_file.clone()))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| TestError::CannotOpenFile(config_file, e.into()))?;
        Ok::<_, TestError>((file, bytes))
    })
    .await
    .map_err(move |e| {
        let e = IOError::new(IOErrorKind::Other, e);
        TestError::CannotOpenFile(config_file2, e.into())
    })??;

    // watch for ctrl-c and kill the test
    let test_ended_tx2 = test_ended_tx.clone();
    let mut test_ended_rx2 = test_ended_tx.subscribe();
    tokio::spawn(future::poll_fn(move |cx| {
        match ctrlc_channel.poll_next_unpin(cx) {
            Poll::Ready(_) => {
                let _ = test_ended_tx2.send(Ok(TestEndReason::CtrlC));
                Poll::Ready(())
            }
            Poll::Pending => test_ended_rx2.poll_next_unpin(cx).map(|_| ()),
        }
    }));

    let env_vars = std::env::vars_os()
        .map(|(k, v)| (k.to_string_lossy().into(), v.to_string_lossy().into()))
        .collect();
    let output_format = exec_config.get_output_format();
    let config_file_path = exec_config.get_config_file().clone();
    let config =
        config::LoadTest::from_config(&config_bytes, exec_config.get_config_file(), &env_vars)?;
    let test_runner = match exec_config {
        ExecConfig::Try(t) => create_try_run_future(
            config,
            t,
            (test_ended_tx.clone(), test_ended_tx.subscribe()),
            stdout,
            stderr,
        )
        .map(Either::A),
        ExecConfig::Run(r) => {
            if r.watch_config_file {
                create_config_watcher(
                    file,
                    env_vars,
                    stdout.clone(),
                    stderr.clone(),
                    test_ended_tx.clone(),
                    output_format,
                    r.clone(),
                    config_file_path,
                );
            }
            let test_ended_rx = test_ended_tx.subscribe();
            create_load_test_future(config, r, (test_ended_tx, test_ended_rx), stdout, stderr)
                .map(Either::B)
        }
    };
    match test_runner {
        Ok(f) => {
            tokio::spawn(f);
            let mut test_result = Ok(TestEndReason::Completed);
            while let Some(v) = test_ended_rx.next().await {
                match v {
                    Ok(Ok(TestEndReason::TestUpdate)) => continue,
                    Ok(v) => {
                        test_result = v;
                    }
                    _ => (),
                };
                break;
            }
            test_result
        }
        Err(e) => Err(e),
    }
}

pub async fn create_run<So, Se>(
    exec_config: ExecConfig,
    ctrlc_channel: FCUnboundedReceiver<()>,
    stdout: So,
    stderr: Se,
) -> Result<(), ()>
where
    So: Write + Send + 'static,
    Se: Write + Send + 'static,
{
    let (test_ended_tx, test_ended_rx) = broadcast::channel(1);
    let output_format = exec_config.get_output_format();
    let stdout = blocking_writer(stdout);
    let mut stderr = blocking_writer(stderr);
    let test_result = _create_run(
        exec_config,
        ctrlc_channel,
        stdout,
        stderr.clone(),
        test_ended_tx.clone(),
        test_ended_rx,
    )
    .await;

    match test_result {
        Err(e) => {
            // send the test end message to ensure the stats channel closes
            let _ = test_ended_tx.send(Ok(TestEndReason::Completed));
            let msg = match output_format {
                RunOutputFormat::Human => format!("\n{} {}\n", Paint::red("Fatal error").bold(), e),
                RunOutputFormat::Json => {
                    let json = json::json!({"type": "fatal", "msg": format!("{}", e)});
                    format!("{}\n", json)
                }
            };
            let _ = stderr.send(MsgType::Final(msg)).await;
            return Err(());
        }
        Ok(TestEndReason::KilledByLogger) => {
            let msg = match output_format {
                RunOutputFormat::Human => format!(
                    "\n{}\n",
                    Paint::yellow("Test killed early by logger").bold()
                ),
                RunOutputFormat::Json => {
                    "{\"type\":\"end\",\"msg\":\"Test killed early by logger\"}\n".to_string()
                }
            };
            let _ = stderr.send(MsgType::Final(msg)).await;
        }
        Ok(TestEndReason::CtrlC) => {
            let msg = match output_format {
                RunOutputFormat::Human => format!(
                    "\n{}\n",
                    Paint::yellow("Test killed early by Ctrl-c").bold()
                ),
                RunOutputFormat::Json => {
                    "{\"type\":\"end\",\"msg\":\"Test killed early by Ctrl-c\"}\n".to_string()
                }
            };
            let _ = stderr.send(MsgType::Final(msg)).await;
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
            let _ = stderr.send(MsgType::Final(msg)).await;
        }
        _ => (),
    };
    Ok(())
}

fn create_config_watcher(
    mut file: File,
    env_vars: BTreeMap<String, String>,
    stdout: FCSender<MsgType>,
    mut stderr: FCSender<MsgType>,
    test_ended_tx: broadcast::Sender<Result<TestEndReason, TestError>>,
    output_format: RunOutputFormat,
    run_config: RunConfig,
    config_file_path: PathBuf,
) {
    let mut interval = tokio::time::interval(Duration::from_millis(1000));
    let mut last_modified = None;
    spawn_blocking(move || async move {
        while let Some(_) = interval.next().await {
            let modified = match file.metadata() {
                Ok(m) => match m.modified() {
                    Ok(m) => m,
                    Err(_) => continue,
                },
                Err(_) => continue,
            };

            match last_modified {
                Some(lm) if modified < lm => continue,
                None => {
                    last_modified = Some(modified);
                    continue;
                }
                _ => last_modified = Some(modified),
            }

            if file.seek(SeekFrom::Start(0)).is_err() {
                continue;
            }

            let mut config_bytes = Vec::new();
            if file.read_to_end(&mut config_bytes).is_err() {
                continue;
            }

            let config = config::LoadTest::from_config(&config_bytes, &config_file_path, &env_vars);
            let config = match config {
                Ok(m) => m,
                Err(e) => {
                    let msg = match output_format {
                        RunOutputFormat::Human => format!(
                            "\n{} {}\n",
                            Paint::yellow("Could not reload config file"),
                            e
                        ),
                        RunOutputFormat::Json => {
                            let json = json::json!({"type": "warn", "msg": format!("{} {}", "could not reload config file", e)});
                            format!("{}\n", json)
                        }
                    };
                    let _ = stderr.send(MsgType::Other(msg)).await;
                    continue;
                }
            };

            let f = create_load_test_future(
                config,
                run_config.clone(),
                (test_ended_tx.clone(), test_ended_tx.subscribe()),
                stdout.clone(),
                stderr.clone(),
            );
            let f = match f {
                Ok(f) => f,
                Err(e) => {
                    let msg = match output_format {
                        RunOutputFormat::Human => format!(
                            "\n{} {}\n",
                            Paint::yellow("Could not reload config file"),
                            e
                        ),
                        RunOutputFormat::Json => {
                            let json = json::json!({"type": "warn", "msg": format!("{} {}", "could not reload config file", e)});
                            format!("{}\n", json)
                        }
                    };
                    let _ = stderr.send(MsgType::Other(msg)).await;
                    continue;
                }
            };

            tokio::spawn(f);
        }
    });
}

fn create_try_run_future(
    mut config: config::LoadTest,
    try_config: TryConfig,
    test_ended: TestEndedChannel,
    stdout: FCSender<MsgType>,
    stderr: FCSender<MsgType>,
) -> Result<impl Future<Output = ()>, TestError> {
    let (test_ended_tx, mut test_ended_rx) = test_ended;

    let select = if let TryRunFormat::Human = try_config.format {
        r#""`\
         Request\n\
         ========================================\n\
         ${request['start-line']}\n\
         ${join(request.headers, '\n', ': ')}\n\
         ${if(request.body != '', '\n${request.body}\n', '')}\n\
         Response (RTT: ${stats.rtt}ms)\n\
         ========================================\n\
         ${response['start-line']}\n\
         ${join(response.headers, '\n', ': ')}\n\
         ${if(response.body != '', '\n${response.body}', '')}\n\n`""#
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
    )?;

    let mut endpoints = Endpoints::new();

    for mut endpoint in config.endpoints.into_iter() {
        let required_providers = mem::take(&mut endpoint.required_providers);

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

    let (stats_tx, stats_rx) = create_try_run_stats_channel(test_ended_tx.subscribe(), stderr);
    tokio::spawn(stats_rx);

    let mut builder_ctx = request::BuilderContext {
        config: config_config,
        config_path: try_config.config_file,
        client: Arc::new(client),
        loggers,
        providers,
        stats_tx,
    };

    let endpoint_calls = endpoints.build(filter_fn, &mut builder_ctx, &response_providers)?;

    let mut left = try_join_all(endpoint_calls).map(move |r| {
        let _ = test_ended_tx.send(r.map(|_| TestEndReason::Completed));
    });
    let f = future::poll_fn(move |cx| match left.poll_unpin(cx) {
        Poll::Ready(_) => Poll::Ready(()),
        Poll::Pending => match test_ended_rx.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(_))) => Poll::Ready(()),
            _ => Poll::Pending,
        },
    });
    Ok(f)
}

fn create_load_test_future(
    config: config::LoadTest,
    run_config: RunConfig,
    test_ended: TestEndedChannel,
    stdout: FCSender<MsgType>,
    stderr: FCSender<MsgType>,
) -> Result<impl Future<Output = ()>, TestError> {
    config.ok_for_loadtest()?;

    let (test_ended_tx, mut test_ended_rx) = test_ended;

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
    )?;

    // create the endpoints
    let builders: Vec<_> = config
        .endpoints
        .into_iter()
        .map(|mut endpoint| {
            let mut mod_interval: Option<Pin<Box<dyn Stream<Item = Instant> + Send>>> = None;

            if let (Some(peak_load), Some(load_pattern)) =
                (endpoint.peak_load.as_ref(), endpoint.load_pattern.take())
            {
                let mut mod_interval2 = ModInterval::new();
                let pieces = match load_pattern {
                    config::LoadPattern::Linear(l) => l.pieces,
                };
                for piece in pieces {
                    let (start, end) = match peak_load {
                        config::HitsPer::Minute(m) => (
                            PerX::minute(piece.start_percent * *m as f64),
                            PerX::minute(piece.end_percent * *m as f64),
                        ),
                        config::HitsPer::Second(s) => (
                            PerX::second(piece.start_percent * *s as f64),
                            PerX::second(piece.end_percent * *s as f64),
                        ),
                    };
                    mod_interval2.append_segment(start, duration, end);
                }
                mod_interval = Some(Box::pin(mod_interval2.into_stream(run_config.start_at)));
            }

            request::Builder::new(endpoint, mod_interval)
        })
        .collect();

    let client = create_http_client(config_config.client.keepalive)?;

    let (stats_tx, stats_rx) = create_stats_channel(
        test_ended_tx.subscribe(),
        &config_config.general,
        &providers,
        stdout,
        &run_config,
    )?;
    tokio::spawn(stats_rx);

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

    let _ = stats_tx.unbounded_send(StatsMessage::Start(duration));
    let mut f = try_join_all(endpoint_calls);
    let f = future::poll_fn(move |cx| match f.poll_unpin(cx) {
        Poll::Ready(r) => {
            let _ = test_ended_tx.send(r.map(|_| TestEndReason::Completed));
            Poll::Ready(())
        }
        Poll::Pending => test_ended_rx.poll_next_unpin(cx).map(|_| ()),
    });

    Ok(f)
}

pub(crate) fn create_http_client(
    keepalive: Duration,
) -> Result<
    Client<HttpsConnector<HttpConnector<hyper::client::connect::dns::GaiResolver>>>,
    TestError,
> {
    let mut http = HttpConnector::new();
    http.set_keepalive(Some(keepalive));
    http.set_reuse_address(true);
    http.enforce_http(false);
    let https = HttpsConnector::from((http, TlsConnector::new()?.into()));
    Ok(Client::builder().set_host(false).build::<_, Body>(https))
}

type ProvidersResult = Result<(BTreeMap<String, providers::Provider>, BTreeSet<String>), TestError>;

fn get_providers_from_config(
    config_providers: BTreeMap<String, config::Provider>,
    auto_size: usize,
    test_ended_tx: &broadcast::Sender<Result<TestEndReason, TestError>>,
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

fn get_loggers_from_config(
    config_loggers: BTreeMap<String, config::Logger>,
    results_dir: Option<&PathBuf>,
    test_ended_tx: &broadcast::Sender<Result<TestEndReason, TestError>>,
    stdout: FCSender<MsgType>,
    stderr: FCSender<MsgType>,
) -> Result<BTreeMap<String, providers::Logger>, TestError> {
    config_loggers
        .into_iter()
        .map(|(name, mut template)| {
            let to = mem::take(&mut template.to);
            let name2 = name.clone();
            let writer = match to.as_str() {
                "stdout" => stdout.clone(),
                "stderr" => stderr.clone(),
                _ => {
                    let mut file_path = if let Some(results_dir) = results_dir {
                        results_dir.clone()
                    } else {
                        PathBuf::new()
                    };
                    file_path.push(to);
                    let f = File::create(file_path)
                        .map_err(|e| TestError::CannotCreateLoggerFile(name2, e.into()))?;
                    blocking_writer(f)
                }
            };
            let sender = providers::logger(template, &test_ended_tx, writer);
            Ok((name, sender))
        })
        .collect()
}
