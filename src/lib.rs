#![warn(rust_2018_idioms)]
#![allow(unused_attributes)]
#![type_length_limit = "19550232"]
#![allow(clippy::type_complexity)]

mod error;
mod line_writer;
mod providers;
mod request;
mod stats;
mod util;

use crate::error::TestError;
use crate::stats::{create_stats_channel, create_try_run_stats_channel, StatsMessage};

use config::providers::ProviderName;
use config::query::Query;
use config::{self, common::ProviderSend, loggers::LogTo, templating::Template, LoadTest, Logger};

use clap::{Args, Subcommand, ValueEnum};
use ether::Either;
use futures::{
    channel::mpsc::{
        Sender as FCSender, UnboundedReceiver as FCUnboundedReceiver,
        UnboundedSender as FCUnboundedSender,
    },
    executor::{block_on, block_on_stream},
    future::{self, try_join_all},
    sink::SinkExt,
    stream, FutureExt, Stream, StreamExt,
};
use futures_timer::Delay;
use hyper::{client::HttpConnector, Body, Client};
use hyper_tls::HttpsConnector;
use itertools::Itertools;
use line_writer::{blocking_writer, MsgType};
use log::{debug, error, info, warn};
use mod_interval::{ModInterval, PerX};
use native_tls::TlsConnector;
use serde::Serialize;
use serde_json as json;
use tokio::{sync::broadcast, task::spawn_blocking};
use tokio_stream::wrappers::{BroadcastStream, IntervalStream};
use yansi::Paint;

use std::str::FromStr;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    convert::TryFrom,
    fmt,
    fs::File,
    future::Future,
    io::{Error as IOError, ErrorKind as IOErrorKind, Read, Seek, Write},
    mem,
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
    task::Poll,
    time::{Duration, Instant},
};

struct Endpoints {
    inner: Vec<(
        BTreeMap<Arc<str>, String>,
        request::EndpointBuilder,
        BTreeSet<Arc<str>>,
    )>,
    // provider name, yaml index of endpoints which provide the provider
    providers: BTreeMap<Arc<str>, Vec<usize>>,
}

impl Endpoints {
    fn new() -> Self {
        Self {
            inner: Vec::new(),
            providers: BTreeMap::new(),
        }
    }

    fn append(
        &mut self,
        endpoint_tags: BTreeMap<Arc<str>, String>,
        builder: request::EndpointBuilder,
        provides: BTreeSet<Arc<str>>,
        required_providers: BTreeSet<Arc<str>>,
    ) {
        let i = self.inner.len();
        self.inner
            .push((endpoint_tags, builder, required_providers));
        for p in provides {
            self.providers.entry(p).or_default().push(i);
        }
    }

    #[allow(clippy::unnecessary_wraps)]
    fn build<F>(
        self,
        filter_fn: F,
        builder_ctx: &request::BuilderContext,
        response_providers: &BTreeSet<Arc<str>>,
    ) -> Result<Vec<impl Future<Output = Result<(), TestError>> + Send>, TestError>
    where
        F: Fn(&BTreeMap<Arc<str>, String>) -> bool,
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

#[derive(Copy, Clone, Debug, Serialize, ValueEnum, Default)]
pub enum RunOutputFormat {
    #[default]
    Human,
    Json,
}

impl fmt::Display for RunOutputFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}",
            match self {
                Self::Json => "json",
                Self::Human => "human",
            }
        )
    }
}

impl RunOutputFormat {
    pub fn is_human(self) -> bool {
        matches!(self, Self::Human)
    }
}

impl TryFrom<&str> for RunOutputFormat {
    type Error = ();

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "human" => Ok(Self::Human),
            "json" => Ok(Self::Json),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Debug, Serialize, ValueEnum, Default)]
pub enum StatsFileFormat {
    // Html,
    #[default]
    Json,
    // None,
}

impl fmt::Display for StatsFileFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}",
            match self {
                Self::Json => "json",
            }
        )
    }
}

#[derive(Clone, Debug, Default, Serialize, ValueEnum)]
pub enum TryRunFormat {
    #[default]
    Human,
    Json,
}

impl TryRunFormat {
    pub fn is_human(self) -> bool {
        matches!(self, Self::Human)
    }
}

impl fmt::Display for TryRunFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}",
            match self {
                Self::Human => "human",
                Self::Json => "json",
            }
        )
    }
}

impl TryFrom<&str> for TryRunFormat {
    type Error = ();

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "human" => Ok(Self::Human),
            "json" => Ok(Self::Json),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Args)]
pub struct RunConfig {
    /// Load test config file to use
    #[arg(value_name = "CONFIG")]
    pub config_file: PathBuf,
    /// Formatting for stats printed to stdout
    #[arg(short = 'f', long, value_name = "FORMAT", default_value_t)]
    pub output_format: RunOutputFormat,
    /// Directory to store results and logs
    #[arg(short = 'd', long = "results-directory", value_name = "DIRECTORY")]
    pub results_dir: Option<PathBuf>,
    /// Specify the time the test should start at
    #[arg(value_parser = |s: &str| config::duration_from_string(s.into()).ok_or("invalid duration"), short = 't', long)]
    pub start_at: Option<Duration>,
    /// Specify the filename for the stats file
    #[arg(short = 'o', long)]
    pub stats_file: PathBuf,
    /// Format for the stats file
    #[arg(short, long, value_name = "FORMAT", default_value_t)]
    pub stats_file_format: StatsFileFormat,
    /// Watch the config file for changes and update the test accordingly
    #[arg(short, long = "watch")]
    pub watch_config_file: bool,
}

impl fmt::Display for RunConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", serde_json::to_string(&self).unwrap_or_default())
    }
}

#[derive(Clone, Debug, Serialize)]
pub enum TryFilter {
    Eq(String, String),
    Ne(String, String),
}

impl FromStr for TryFilter {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        use once_cell::sync::Lazy;
        use regex::Regex;

        // TODO: replace once_cell::sync::Lazy with std::sync::LazyLock once that gets stabilized
        // out of nightly
        static REGEX: Lazy<Regex> =
            Lazy::new(|| Regex::new("^(.*?)(!=|=)(.*)").expect("is a valid regex"));

        let caps = REGEX.captures(s).ok_or("failed match")?;

        // Should never panic, as the Regex's known success at this point guarantees that all
        // capture groups are present.
        let lhs = caps.get(1).unwrap().as_str().to_owned();
        let cmp = caps.get(2).unwrap().as_str();
        let rhs = caps.get(3).unwrap().as_str().to_owned();
        Ok((match cmp {
            "=" => Self::Eq,
            "!=" => Self::Ne,
            _ => unreachable!(r#"Regex can only catch "=" or "!=" here."#),
        })(lhs, rhs))
    }
}

#[derive(Clone, Debug, Serialize, Args)]
pub struct TryConfig {
    /// Load test config file to use
    pub config_file: PathBuf,
    /// Send results to the specified file instead of stdout
    #[arg(short = 'o', long)]
    pub file: Option<String>,
    /// Filter which endpoints are included in the try run. Filters work based on an
    /// endpoint's tags. Filters are specified in the format "key=value" where "*" is
    /// a wildcard. Any endpoint matching the filter is included in the test
    #[arg(short = 'i', long = "include", value_parser = TryFilter::from_str, value_name = "INCLUDE")]
    pub filters: Option<Vec<TryFilter>>,
    /// Specify the format for the try run output
    #[arg(short, long, default_value_t)]
    pub format: TryRunFormat,
    /// Enable loggers defined in the config file
    #[arg(short = 'l', long = "loggers")]
    pub loggers_on: bool,
    /// Directory to store logs (if enabled with --loggers)
    #[arg(short = 'd', long = "results-directory", value_name = "DIRECTORY")]
    pub results_dir: Option<PathBuf>,
    /// Skips reponse body from output
    #[arg(short = 'k', long = "skip-response-body")]
    pub skip_response_body_on: bool,
    /// Skips request body from output
    #[arg(short = 'K', long = "skip-request-body")]
    pub skip_request_body_on: bool,
}

impl fmt::Display for TryConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", serde_json::to_string(&self).unwrap_or_default())
    }
}

#[derive(Serialize, Subcommand, Debug)]
pub enum ExecConfig {
    /// Runs a full load test
    Run(RunConfig),
    /// Runs the specified endpoint(s) a single time for testing purposes
    Try(TryConfig),
}

impl fmt::Display for ExecConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", serde_json::to_string(&self).unwrap_or_default())
    }
}

impl ExecConfig {
    fn get_config_file(&self) -> &PathBuf {
        match self {
            Self::Run(r) => &r.config_file,
            Self::Try(t) => &t.config_file,
        }
    }

    fn get_output_format(&self) -> RunOutputFormat {
        match self {
            Self::Run(r) => r.output_format,
            Self::Try(_) => RunOutputFormat::Human,
        }
    }
}

/// The reason the test ended, whether temporarily or completely.
///
/// [`Self::ConfigUpdate`] end will allow the test to continue with the updated config, if watch mode was
/// enabled in the [`ExecConfig`].
#[derive(Clone)]
pub enum TestEndReason {
    Completed,
    CtrlC,
    KilledByLogger,
    ProviderEnded,
    ConfigUpdate(Arc<BTreeMap<Arc<str>, providers::Provider>>),
}

/// Inner(1)-level runtime future function.
///
/// Generates runner based on specified values in the [`ExecConfig`], as well as the indicated config
/// YAML file.
///
/// Either a Try future or a Run future is spawned and a test end is awaited for.
///
/// Returns the reason that the test finished, or could not be run.
///
/// # Errors
///
/// Returns an `Err` if the test could not be run.
async fn _create_run(
    exec_config: ExecConfig,
    mut ctrlc_channel: FCUnboundedReceiver<()>,
    stdout: FCSender<MsgType>,
    stderr: FCSender<MsgType>,
    test_ended_tx: broadcast::Sender<Result<TestEndReason, TestError>>,
    mut test_ended_rx: BroadcastStream<Result<TestEndReason, TestError>>,
) -> Result<TestEndReason, TestError> {
    debug!("{{\"_create_run enter");
    let config_file: Arc<Path> = Arc::from(exec_config.get_config_file().clone());
    debug!("{{\"_create_run spawn_blocking start");
    let (file, config_bytes) = {
        let config_file = Arc::clone(&config_file);
        spawn_blocking(move || {
            debug!("{{\"_create_run spawn_blocking enter");
            let mut file = File::open(config_file.clone()).map_err(|err| {
                error!(
                    "File::open({}) error: {}",
                    config_file.clone().to_str().unwrap_or_default(),
                    err
                );
                TestError::InvalidConfigFilePath(config_file.clone())
            })?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).map_err(|e| {
                error!(
                    "File::read_to_end({}) error: {}",
                    config_file.to_str().unwrap_or_default(),
                    e
                );
                TestError::CannotOpenFile(config_file.clone(), e.into())
            })?;
            debug!("{{\"_create_run spawn_blocking exit");
            Ok::<_, TestError>((file, bytes))
        })
    }
    .await
    .map_err({
        let config_file = Arc::clone(&config_file);
        move |e| {
            warn!("config file error: {}", e);
            let e = IOError::new(IOErrorKind::Other, e);
            TestError::CannotOpenFile(config_file, e.into())
        }
    })??;

    // watch for ctrl-c and kill the test
    let test_ended_tx2 = test_ended_tx.clone();
    let mut test_ended_rx2 = BroadcastStream::new(test_ended_tx.subscribe());
    debug!("_create_run tokio::spawn future::poll_fn ctrl-c");
    tokio::spawn(future::poll_fn(move |cx| {
        match ctrlc_channel.poll_next_unpin(cx) {
            Poll::Ready(r) => {
                if r.is_some() {
                    let _ = test_ended_tx2.send(Ok(TestEndReason::CtrlC));
                }
                Poll::Ready(())
            }
            Poll::Pending => test_ended_rx2.poll_next_unpin(cx).map(|_| ()),
        }
    }));

    let env_vars: BTreeMap<String, String> = std::env::vars_os()
        .map(|(k, v)| (k.to_string_lossy().into(), v.to_string_lossy().into()))
        .collect();
    // Don't log the values in case there are passwords
    debug!("env_vars={:?}", env_vars.clone().keys());
    log::trace!("env_vars={:?}", env_vars.clone());
    let output_format = exec_config.get_output_format();
    let mut config = LoadTest::from_yaml(
        std::str::from_utf8(&config_bytes).expect("TODO: HANDLE THIS"),
        Arc::clone(&config_file),
        &env_vars,
    )
    .map_err(Box::new)?;
    debug!("config::LoadTest::from_config finished: {:?}", config);
    let test_runner = match exec_config {
        ExecConfig::Try(t) => {
            create_try_run_future(config, t, test_ended_tx.clone(), stdout, stderr).map(Either::A)
        }
        ExecConfig::Run(r) => {
            let config_providers = mem::take(&mut config.providers);
            // build and register the providers
            let (providers, _) = get_providers_from_config(
                &config_providers,
                config.config.general.auto_buffer_start_size as usize,
                &test_ended_tx,
                &r.config_file,
            )?;

            let stats_tx = create_stats_channel(
                test_ended_tx.clone(),
                &config.config.general,
                &providers,
                stdout.clone(),
                &r,
            )?;

            let providers = Arc::new(providers);

            // Allow continuing test with new config file.
            if r.watch_config_file {
                create_config_watcher(
                    file,
                    env_vars,
                    stdout.clone(),
                    stderr.clone(),
                    test_ended_tx.clone(),
                    output_format,
                    r.clone(),
                    Arc::clone(&config_file),
                    stats_tx.clone(),
                    config_providers,
                    providers.clone(),
                    config.get_lib_path(),
                );
            }

            create_load_test_future(
                config,
                r,
                test_ended_tx,
                providers,
                stats_tx,
                stdout,
                stderr,
            )
            .map(Either::B)
        }
    };
    match test_runner {
        Ok(f) => {
            debug!("_create_run tokio::spawn test_runner");
            // Start running the test.
            tokio::spawn(f);
            let mut test_result = Ok(TestEndReason::Completed);
            // Wait until the test is done.
            while let Some(v) = test_ended_rx.next().await {
                match v {
                    // If test end was due to config change, keep going with new config.
                    Ok(Ok(TestEndReason::ConfigUpdate(_))) => continue,
                    // Any other reason, and the test ends fully.
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

/// Outermost-level runtime future function.
///
/// Creates worker future, and checks the circumstances under which it terminates. Specific
/// information regarding the termination reason is not returned, but rather dispatched through
/// logging.
///
/// # Errors
///
/// Returns `Err(())` if the worker future returns an `Err`.
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
    debug!(
        "{{\"method\":\"create_run enter\",\"exec_config\":{}}}",
        exec_config
    );
    let (test_ended_tx, test_ended_rx) = broadcast::channel(1);
    let test_ended_rx = BroadcastStream::new(test_ended_rx);
    let output_format = exec_config.get_output_format();
    let (stdout, stdout_done) = blocking_writer(stdout, test_ended_tx.clone(), "stdout".into());
    let (mut stderr, stderr_done) = blocking_writer(stderr, test_ended_tx.clone(), "stderr".into());
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
            error!("TestError: {}", e);
            let _ = test_ended_tx.send(Ok(TestEndReason::Completed));
            let msg = match output_format {
                RunOutputFormat::Human => format!("\n{} {}\n", Paint::red("Fatal error").bold(), e),
                RunOutputFormat::Json => {
                    let json = json::json!({"type": "fatal", "msg": format!("{e}")});
                    format!("{json}\n")
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
        // Instead of implementing Display for TestEndReason, just log these other two
        Ok(TestEndReason::Completed) => info!("Test Ended with: Completed"),
        Ok(TestEndReason::ConfigUpdate(_)) => info!("Test Ended with: ConfigUpdate"),
    };
    drop(stderr);
    // wait for all stderr and stdout output to be written
    let _ = stderr_done.await;
    let _ = stdout_done.await;
    Ok(())
}

/// Create a watcher to see when the config file has been updated.
///
/// If watch mode has been enabled for the [`RunConfig`], this will be called during future generation
/// (but not in the [`create_load_test_future`] function)
/// to enable updating the configuration, and continuing from the same time point.
#[allow(clippy::too_many_arguments)]
fn create_config_watcher(
    mut file: File,
    env_vars: BTreeMap<String, String>,
    stdout: FCSender<MsgType>,
    mut stderr: FCSender<MsgType>,
    test_ended_tx: broadcast::Sender<Result<TestEndReason, TestError>>,
    output_format: RunOutputFormat,
    run_config: RunConfig,
    config_file_path: Arc<Path>,
    stats_tx: FCUnboundedSender<StatsMessage>,
    mut previous_config_providers: BTreeMap<ProviderName, config::ProviderType>,
    mut previous_providers: Arc<BTreeMap<Arc<str>, providers::Provider>>,
    lib_path: Option<Arc<Path>>,
) {
    let start_time = Instant::now();
    let mut interval = IntervalStream::new(tokio::time::interval(Duration::from_millis(1000)));
    let mut last_modified = None;
    let mut test_end_rx = BroadcastStream::new(test_ended_tx.subscribe());
    let stream = stream::poll_fn(move |cx| match interval.poll_next_unpin(cx) {
        Poll::Ready(_) => Poll::Ready(Some(())),
        Poll::Pending => match test_end_rx.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(Ok(TestEndReason::ConfigUpdate(_))))) | Poll::Pending => {
                Poll::Pending
            }
            Poll::Ready(_) => Poll::Ready(None),
        },
    });
    debug!("{{\"create_config_watcher spawn_blocking start");
    spawn_blocking(move || {
        debug!("{{\"create_config_watcher spawn_blocking enter");
        let mut stream_counter = 1;
        for _ in block_on_stream(stream) {
            debug!(
                "{{\"create_config_watcher block_on_stream: {}",
                stream_counter
            );
            stream_counter += 1;
            let modified = {
                // get the most recent file modified; either the config yaml file, or the external
                // js library file, it one exists
                let m = lib_path
                    .as_ref()
                    .map(|p| std::fs::metadata(p).and_then(|m| m.modified()))
                    .transpose()
                    .and_then(|lm| {
                        file.metadata()
                            .and_then(|m| m.modified())
                            .map(move |m| (lm, m))
                    })
                    .map(|(lm, cm)| lm.map_or(cm, |m| m.max(cm)));
                match m {
                    Ok(m) => m,
                    // If retrieving either modifed time fails, skip the check.
                    Err(_) => continue,
                }
            };

            // Check the last modified. If we don't have one, or it hasn't changed, continue to the next loop
            match last_modified {
                Some(lm) if modified == lm => continue,
                None => {
                    last_modified = Some(modified);
                    continue;
                }
                Some(_) => last_modified = Some(modified),
            }

            // Last modified has changed
            if file.rewind().is_err() {
                continue;
            }

            let mut config_bytes = Vec::new();
            if file.read_to_end(&mut config_bytes).is_err() {
                continue;
            }

            // Config file has updated, re-parse and update.

            // A decent amount of this code seems similar to that in `_create_run`; could
            // this be unified into a common function?

            let config = LoadTest::from_yaml(
                std::str::from_utf8(&config_bytes).expect("TODO"),
                Arc::clone(&config_file_path),
                &env_vars,
            );
            let mut config = match config {
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
                            format!("{json}\n")
                        }
                    };
                    let _ = block_on(stderr.send(MsgType::Other(msg)));
                    continue;
                }
            };

            let config_providers = mem::take(&mut config.providers);

            // build and register the providers
            let providers = get_providers_from_config(
                &config_providers,
                config.config.general.auto_buffer_start_size as usize,
                &test_ended_tx,
                &run_config.config_file,
            );
            let mut providers = match providers {
                Ok((p, _)) => p,
                Err(e) => {
                    let msg = match output_format {
                        RunOutputFormat::Human => format!(
                            "\n{} {}\n",
                            Paint::yellow("Could not reload config file"),
                            e
                        ),
                        RunOutputFormat::Json => {
                            let json = json::json!({"type": "warn", "msg": format!("{} {}", "could not reload config file", e)});
                            format!("{json}\n")
                        }
                    };
                    let _ = block_on(stderr.send(MsgType::Other(msg)));
                    continue;
                }
            };

            // see which providers haven't changed and reuse the old providers for the new run
            for (name, p) in &config_providers {
                match previous_config_providers.get(name) {
                    Some(p2) if p == p2 => {
                        if let Some(p) = previous_providers.get(&name.get()) {
                            providers.insert(name.get(), p.clone());
                        }
                    }
                    _ => (),
                }
            }

            let providers = Arc::new(providers);
            previous_providers = providers.clone();
            previous_config_providers = config_providers;

            let mut run_config = run_config.clone();
            run_config.start_at = Some(Instant::now() - start_time);

            // old test is killed
            if test_ended_tx
                .send(Ok(TestEndReason::ConfigUpdate(providers.clone())))
                .is_err()
            {
                break;
            }

            // start new test
            //
            // this happens after killing the old test, so only one is active, fulfilling the
            // condition required by the scripting
            let f = create_load_test_future(
                config,
                run_config,
                test_ended_tx.clone(),
                providers,
                stats_tx.clone(),
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
                            format!("{json}\n")
                        }
                    };
                    let _ = block_on(stderr.send(MsgType::Other(msg)));
                    continue;
                }
            };

            debug!("create_config_watcher tokio::spawn create_load_test_future");
            tokio::spawn(f);
        }
        debug!("{{\"create_config_watcher spawn_blocking exit");
    });
}

/// Inner(2)-level function, used to create worker future for a try run.
///
/// # Errors
///
/// TODO.
fn create_try_run_future(
    mut config: LoadTest,
    try_config: TryConfig,
    test_ended_tx: broadcast::Sender<Result<TestEndReason, TestError>>,
    stdout: FCSender<MsgType>,
    stderr: FCSender<MsgType>,
) -> Result<impl Future<Output = ()>, TestError> {
    debug!("create_try_run_future start");
    // create a logger for the try run
    // request.headers only logs single Accept Headers due to JSON requirements. Use headers_all instead
    let request_body_template = if try_config.skip_request_body_on {
        ""
    } else if matches!(try_config.format, TryRunFormat::Human) {
        "${request.body != '' ? request.body : ''}\n"
    } else {
        r#","body": "request.body""#
    };
    let response_body_template = if try_config.skip_response_body_on {
        ""
    } else if matches!(try_config.format, TryRunFormat::Human) {
        "${response.body != '' ? JSON.stringify(response.body) : ''}\n"
    } else {
        r#","body": "response.body""#
    };
    let select = if matches!(try_config.format, TryRunFormat::Human) {
        Query::simple(
            format!(
                r#"`\
Request\n\
========================================\n\
${{request['start-line']}}\n\
${{join(request['headers_all'], '\n', ': ')}}\n\
{}\

Response (RTT: ${{stats.rtt}}ms)\n\
========================================\n\
${{response['start-line']}}\n\
${{join(response.headers_all, '\n', ': ')}}\n\
{}\n`"#,
                request_body_template, response_body_template
            ),
            vec![],
            None,
        )
    } else {
        Query::from_json(
            format!(
                r#"{{
                    "request": {{
                        "start-line": "request['start-line']",
                        "headers": "request.headers_all"
                        {}
                    }},
                    "response": {{
                        "start-line": "response['start-line']",
                        "headers": "response.headers_all"
                        {}
                    }},
                    "stats": {{
                        "RTT": "stats.rtt"
                    }}
                }}"#,
                request_body_template, response_body_template
            )
            .as_str(),
        )
    };
    debug!("create_try_run_future select: {:?}", select);
    let to = try_config.file.map_or(LogTo::Stdout, |path| {
        LogTo::File(Template::new_literal(path))
    });
    let logger = Logger {
        query: Some(select.expect("should be valid")),
        to,
        pretty: false,
        kill: false,
        limit: None,
    };
    if !try_config.loggers_on {
        debug!("loggers_on: {}. Clearing Loggers", try_config.loggers_on);
        config.clear_loggers();
    }
    debug!("try logger: {:?}", logger);
    config.add_logger("try_run".into(), logger);

    let config_config = config.config;

    // build and register the providers
    let (providers, response_providers) = get_providers_from_config(
        &config.providers,
        config_config.general.auto_buffer_start_size as usize,
        &test_ended_tx,
        &try_config.config_file,
    )?;

    // setup "filters" which decide which endpoints are included in this try run
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
            let right = format!("^{right}$");
            (
                is_eq,
                key,
                // Should never panic, as regex::escape ensures that the result is a valid literal,
                // and the only expressions added after are ".*?"
                regex::Regex::new(&right).expect("filter should be a valid regex"),
            )
        })
        .collect();
    let filter_fn = move |tags: &BTreeMap<Arc<str>, String>| -> bool {
        filters.is_empty()
            || filters.iter().any(|(is_eq, key, regex)| {
                // "should it match" compared to "does it match"
                *is_eq
                    == tags
                        .get::<str>(key)
                        .map_or(false, |left| regex.is_match(left))
            })
    };

    // create the loggers
    let loggers = get_loggers_from_config(
        config.loggers,
        try_config.results_dir.as_ref(),
        &test_ended_tx,
        &stdout,
        &stderr,
    )?;

    let mut endpoints = Endpoints::new();

    // create the endpoints
    for mut endpoint in config.endpoints.into_iter() {
        let required_providers = endpoint.get_required_providers();

        let provides_set = endpoint
            .provides
            .iter_mut()
            .filter_map(|(k, s)| {
                s.set_send_behavior(ProviderSend::Block);
                (!required_providers.contains(k)).then(|| k.clone())
            })
            .collect::<BTreeSet<_>>();
        endpoint.on_demand = true;

        let static_tags = endpoint
            .tags
            .iter()
            .filter_map(|(k, v)| v.as_static().map(|s| (k.clone(), s.to_owned())))
            .collect();

        let builder = request::EndpointBuilder::new(endpoint, None);
        endpoints.append(static_tags, builder, provides_set, required_providers);
    }

    let client = create_http_client(**config_config.client.keepalive.get())?;

    // create the stats channel
    let test_complete = BroadcastStream::new(test_ended_tx.subscribe());
    let stats_tx = create_try_run_stats_channel(test_complete, stderr);

    let builder_ctx = request::BuilderContext {
        config: config_config,
        config_path: try_config.config_file,
        client: Arc::new(client),
        loggers,
        providers: providers.into(),
        stats_tx,
    };

    let endpoint_calls = endpoints.build(filter_fn, &builder_ctx, &response_providers)?;

    let mut test_ended_rx = BroadcastStream::new(test_ended_tx.subscribe());
    let mut left = try_join_all(endpoint_calls).map(move |r| {
        debug!("create_try_run_future try_join_all finish {:?}", r);
        let _ = test_ended_tx.send(r.map(|_| TestEndReason::Completed));
    });
    let f = future::poll_fn(move |cx| match left.poll_unpin(cx) {
        Poll::Ready(_) => Poll::Ready(()),
        Poll::Pending => match test_ended_rx.poll_next_unpin(cx) {
            Poll::Ready(Some(Ok(_))) => Poll::Ready(()),
            _ => Poll::Pending,
        },
    });
    debug!("create_try_run_future finish");
    Ok(f)
}

/// Inner(2)-level function, used to create worker future for a full load test.
///
/// # Errors
///
/// Returns an `Err` if the config file is missing data that a full test requires.
fn create_load_test_future(
    config: LoadTest,
    run_config: RunConfig,
    test_ended_tx: broadcast::Sender<Result<TestEndReason, TestError>>,
    providers: Arc<BTreeMap<Arc<str>, providers::Provider>>,
    stats_tx: FCUnboundedSender<StatsMessage>,
    stdout: FCSender<MsgType>,
    stderr: FCSender<MsgType>,
) -> Result<impl Future<Output = ()>, TestError> {
    debug!("create_load_test_future start");
    config.ok_for_loadtest()?;

    let mut duration = config.get_duration();
    if let Some(t) = run_config.start_at {
        duration = duration.checked_sub(t).unwrap_or_default();
    }

    let config_config = config.config;

    // create the loggers
    let loggers = get_loggers_from_config(
        config.loggers,
        run_config.results_dir.as_ref(),
        &test_ended_tx,
        &stdout,
        &stderr,
    )?;

    // create the endpoints
    #[allow(clippy::needless_collect)]
    let builders: Vec<_> = config
        .endpoints
        .into_iter()
        .map(|mut endpoint| {
            let mut mod_interval: Option<
                Pin<Box<dyn Stream<Item = (Instant, Option<Instant>)> + Send>>,
            > = None;

            if let (Some(peak_load), Some(load_pattern)) =
                (endpoint.peak_load.as_ref(), endpoint.load_pattern.take())
            {
                let mut mod_interval2 = ModInterval::new();
                for piece in load_pattern {
                    let (from, to, over) = piece.into_pieces(PerX::minute, peak_load.get());
                    mod_interval2.append_segment(from, **over, to);
                }

                mod_interval = Some(Box::pin(mod_interval2.into_stream(run_config.start_at)));
            }

            request::EndpointBuilder::new(endpoint, mod_interval)
        })
        .collect();

    let client = create_http_client(**config_config.client.keepalive.get())?;

    let builder_ctx = request::BuilderContext {
        config: config_config,
        config_path: run_config.config_file,
        client: Arc::new(client),
        loggers,
        providers,
        stats_tx: stats_tx.clone(),
    };

    // Create Futures that run each the load test on each endpoint.
    let endpoint_calls = builders
        .into_iter()
        .map(move |builder| builder.build(&builder_ctx).into_future());

    let _ = stats_tx.unbounded_send(StatsMessage::Start(duration));
    // New Future that runs all the endpoint futures.
    let mut f = try_join_all(endpoint_calls);
    let mut test_timeout = Delay::new(duration);
    let mut test_ended_rx = BroadcastStream::new(test_ended_tx.subscribe());
    // Future that checks for test end, either naturally or forced.
    let f = future::poll_fn(move |cx| match f.poll_unpin(cx) {
        Poll::Ready(r) => {
            // Test is done normally.
            let _ = test_ended_tx.send(r.map(|_| TestEndReason::Completed));
            Poll::Ready(())
        }
        Poll::Pending => match test_ended_rx.poll_next_unpin(cx).map(|_| ()) {
            // check if test is forced to stop
            Poll::Ready(_) => Poll::Ready(()),
            Poll::Pending => match test_timeout.poll_unpin(cx) {
                Poll::Ready(_) => {
                    let _ = test_ended_tx.send(Ok(TestEndReason::Completed));
                    Poll::Ready(())
                }
                Poll::Pending => Poll::Pending,
            },
        },
    });

    debug!("create_load_test_future finish");
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

type ProvidersResult =
    Result<(BTreeMap<Arc<str>, providers::Provider>, BTreeSet<Arc<str>>), TestError>;

fn get_providers_from_config(
    config_providers: &BTreeMap<ProviderName, config::ProviderType>,
    auto_size: usize,
    test_ended_tx: &broadcast::Sender<Result<TestEndReason, TestError>>,
    config_path: &Path,
) -> ProvidersResult {
    let mut providers = BTreeMap::new();
    let mut response_providers = BTreeSet::new();
    for (name, template) in config_providers {
        use config::providers::ProviderType;
        let provider = match template.clone() {
            ProviderType::Range(rg) => providers::range(rg, name, auto_size),
            ProviderType::List(lp) => providers::list(lp, name, auto_size),
            ProviderType::File(mut f) => {
                util::tweak_path(f.path.get_mut(), config_path);
                providers::file(f, test_ended_tx.clone(), name, auto_size)?
            }
            ProviderType::Response(r) => {
                response_providers.insert(name.get());
                providers::response(r, name, auto_size)
            }
        };
        providers.insert(name.get(), provider);
    }
    providers.insert(Arc::from("null"), providers::null("null"));
    Ok((providers, response_providers))
}

fn get_loggers_from_config(
    config_loggers: BTreeMap<Arc<str>, config::Logger>,
    results_dir: Option<&PathBuf>,
    test_ended_tx: &broadcast::Sender<Result<TestEndReason, TestError>>,
    stdout: &FCSender<MsgType>,
    stderr: &FCSender<MsgType>,
) -> Result<BTreeMap<Arc<str>, providers::Logger>, TestError> {
    config_loggers
        .into_iter()
        .map(|(name, logger)| {
            let name2 = name.clone();
            let writer = match &logger.to {
                LogTo::Stdout => stdout.clone(),
                LogTo::Stderr => stderr.clone(),
                LogTo::File(path) => {
                    let mut file_path = results_dir.map_or_else(PathBuf::new, Clone::clone);
                    file_path.push(path.get());
                    let f = File::create(&file_path)
                        .map_err(|e| TestError::CannotCreateLoggerFile(name2, e.into()))?;
                    blocking_writer(
                        f,
                        test_ended_tx.clone(),
                        file_path.to_string_lossy().to_string(),
                    )
                    .0
                }
            };
            let sender = providers::logger(logger, test_ended_tx, writer);
            Ok((name, sender))
        })
        .collect()
}
