use std::io::{self, IsTerminal};

use futures::channel::mpsc as futures_channel;
use log::{debug, info};
use pewpew::{create_run, ExecConfig, RunOutputFormat, TryRunFormat};
use tokio::runtime;
use yansi::Paint;

mod args {
    use clap::{Args, Parser, Subcommand};
    use pewpew::{
        ExecConfig, RunConfig, RunOutputFormat, StatsFileFormat, TryConfig, TryFilter, TryRunFormat,
    };
    use std::{
        fs::create_dir_all,
        path::PathBuf,
        str::FromStr,
        time::{Duration, UNIX_EPOCH},
    };

    pub fn get_cli_config() -> ExecConfig {
        ArgsData::parse().command.into()
    }
    #[cfg(test)]
    use clap::error::{DefaultFormatter, Error};
    #[cfg(test)]
    use std::ffi::OsString;

    #[cfg(test)]
    pub fn try_parse_from<I, T>(itr: I) -> Result<ExecConfig, Error<DefaultFormatter>>
    where
        I: IntoIterator<Item = T>,
        T: Into<OsString> + Clone,
    {
        Ok(ArgsData::try_parse_from(itr)?.command.into())
    }

    #[derive(Debug, Parser)]
    #[command(
    version = clap::crate_version!(),
    about = "The HTTP load test tool https://familysearch.github.io/pewpew"
)]
    pub struct ArgsData {
        #[command(subcommand)]
        command: ExecConfigTmp,
    }

    // Temporaries are for some properties which require the values of other properties
    // to evaluate. clap will parse directly into the temporaries, and those, which now
    // have all the values, get converted into the "real" config data.
    //
    // Enabling the original structs to be used directly would need a bit of compat breaking, so
    // see if it can be done for 0.6.0

    #[derive(Subcommand, Debug)]
    enum ExecConfigTmp {
        /// Runs a full load test
        Run(RunConfigTmp),
        /// Runs the specified endpoint(s) a single time for testing purposes
        Try(TryConfigTmp),
    }

    impl From<ExecConfigTmp> for ExecConfig {
        fn from(value: ExecConfigTmp) -> Self {
            match value {
                ExecConfigTmp::Try(t) => Self::Try(t.into()),
                ExecConfigTmp::Run(r) => Self::Run(r.into()),
            }
        }
    }

    #[derive(Clone, Debug, Args)]
    struct RunConfigTmp {
        /// Load test config file to use
        #[arg(value_name = "CONFIG")]
        config_file: PathBuf,
        /// Formatting for stats printed to stdout
        #[arg(short = 'f', long, value_name = "FORMAT", default_value_t)]
        output_format: RunOutputFormat,
        /// Directory to store results and logs
        #[arg(short = 'd', long = "results-directory", value_name = "DIRECTORY")]
        results_dir: Option<PathBuf>,
        /// Specify the time the test should start at
        #[arg(value_parser = |s: &str| config::duration_from_string(s.into()).ok_or("invalid duration"), short = 't', long)]
        start_at: Option<Duration>,
        /// Specify the filename for the stats file
        #[arg(short = 'o', long)]
        stats_file: Option<PathBuf>,
        /// Format for the stats file
        #[arg(short, long, value_name = "FORMAT", default_value_t)]
        stats_file_format: StatsFileFormat,
        /// Watch the config file for changes and update the test accordingly
        #[arg(short, long = "watch")]
        watch_config_file: bool,
    }

    impl From<RunConfigTmp> for RunConfig {
        fn from(value: RunConfigTmp) -> Self {
            let config_file = &value.config_file;
            let stats_file: PathBuf = value.stats_file.unwrap_or_else(|| {
                let start_sec = UNIX_EPOCH
                    .elapsed()
                    .map(|d| d.as_secs())
                    .unwrap_or_default();
                let test_name = config_file.file_stem().and_then(std::ffi::OsStr::to_str);
                test_name
                    .map_or_else(
                        || format!("stats-{start_sec}.json"),
                        |test_name| format!("stats-{test_name}-{start_sec}.json"),
                    )
                    .into()
            });
            let stats_file = if let Some(results_dir) = &value.results_dir {
                let mut file = results_dir.clone();
                file.push(stats_file);
                file
            } else {
                stats_file
            };
            Self {
                config_file: value.config_file,
                output_format: value.output_format,
                results_dir: value.results_dir,
                start_at: value.start_at,
                stats_file,
                stats_file_format: value.stats_file_format,
                watch_config_file: value.watch_config_file,
            }
        }
    }

    #[derive(Clone, Debug, Args)]
    struct TryConfigTmp {
        /// Load test config file to use
        #[arg(value_name = "CONFIG")]
        config_file: PathBuf,
        /// Send results to the specified file instead of stdout
        #[arg(short = 'o', long)]
        file: Option<String>,
        /// Specify the format for the try run output
        #[arg(short, long, default_value_t)]
        format: TryRunFormat,
        /// Filter which endpoints are included in the try run. Filters work based on an
        /// endpoint's tags. Filters are specified in the format "key=value" where "*" is
        /// a wildcard. Any endpoint matching the filter is included in the test
        #[arg(short = 'i', long = "include", value_parser = TryFilter::from_str, value_name = "INCLUDE")]
        filters: Option<Vec<TryFilter>>,
        /// Enable loggers defined in the config file
        #[arg(short = 'l', long = "loggers")]
        loggers_on: bool,
        /// Directory to store logs (if enabled with --loggers)
        #[arg(short = 'd', long = "results-directory", value_name = "DIRECTORY")]
        results_dir: Option<PathBuf>,
        /// Skips reponse body from output
        #[arg(short = 'k', long = "skip-response-body")]
        skip_response_body_on: bool,
        /// Skips request body from output
        #[arg(short = 'K', long = "skip-request-body")]
        skip_request_body_on: bool,
    }

    impl From<TryConfigTmp> for TryConfig {
        fn from(value: TryConfigTmp) -> Self {
            let loggers_on = value.loggers_on;
            let skip_response_body_on = value.skip_response_body_on;
            let skip_request_body_on = value.skip_request_body_on;
            let results_dir = value.results_dir.filter(|_| loggers_on);
            if let Some(d) = &results_dir {
                create_dir_all(d).unwrap();
            }

            Self {
                config_file: value.config_file,
                loggers_on,
                results_dir,
                filters: value.filters,
                file: value.file,
                format: value.format,
                skip_response_body_on,
                skip_request_body_on,
            }
        }
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    {
        if !Paint::enable_windows_ascii() {
            Paint::disable();
        }
    }
    if !io::stdout().is_terminal() {
        Paint::disable();
    }

    let (ctrl_c_tx, ctrlc_channel) = futures_channel::unbounded();

    let _ = ctrlc::set_handler(move || {
        let _ = ctrl_c_tx.unbounded_send(());
    });

    let cli_config = args::get_cli_config();
    // For testing, we can only call the logger inits once. They can't be in get_cli_config so we can call it multiple times
    match cli_config {
        ExecConfig::Run(ref run_config) => {
            match run_config.output_format {
                RunOutputFormat::Json => {
                    json_env_logger::init();
                    json_env_logger::panic_hook();
                }
                _ => env_logger::init(),
            }
            info!("log::max_level() = {}", log::max_level());
            debug!("{{\"run_config\":{}}}", run_config);
        }
        ExecConfig::Try(ref try_config) => {
            match try_config.format {
                TryRunFormat::Json => {
                    json_env_logger::init();
                    json_env_logger::panic_hook();
                }
                _ => env_logger::init(),
            }
            info!("log::max_level()={}", log::max_level());
            debug!("{{\"try_config\":{}}}", try_config);
        }
    }

    // Create Future to run full load test or try test.
    let f = create_run(cli_config, ctrlc_channel, io::stdout(), io::stderr());

    let rt = runtime::Builder::new_multi_thread()
        .enable_time()
        .enable_io()
        .thread_name("pewpew-worker")
        .build()
        .unwrap();
    debug!("rt.block_on start");
    // Run Future to completion
    let result = rt.block_on(f);
    debug!("rt.block_on finished. result: {:?}", result);
    // shutdown the runtime in case there are any hanging threads/tasks
    rt.shutdown_timeout(Default::default());
    debug!("rt.shutdown_timeout finished");

    if result.is_err() {
        std::process::exit(1)
    }
}

#[cfg(test)]
mod tests {
    use pewpew::{StatsFileFormat, TryFilter};
    use regex::Regex;
    use std::time::Duration;

    use super::*;

    static RUN_COMMAND: &str = "run";
    static TRY_COMMAND: &str = "try";
    static YAML_FILE: &str = "./tests/integration.yaml";
    static YAML_FILE2: &str = "./tests/int_on_demand.yaml";
    static TEST_DIR: &str = "./tests/";
    static STATS_FILE: &str = "stats-paths.json";

    #[test]
    fn base_clap_verify() {
        use clap::CommandFactory;
        args::ArgsData::command().debug_assert();
    }

    #[test]
    fn cli_run_simple() {
        let stats_regex = Regex::new(r"^stats-integration-\d+\.json$").unwrap();
        let cli_config: ExecConfig =
            args::try_parse_from(["myprog", RUN_COMMAND, YAML_FILE]).unwrap();
        let ExecConfig::Run(run_config) = cli_config else {
            panic!("subcommand was not `run`")
        };
        assert_eq!(run_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(matches!(run_config.output_format, RunOutputFormat::Human));
        assert!(run_config.results_dir.is_none());
        assert!(run_config.start_at.is_none());
        assert!(stats_regex.is_match(run_config.stats_file.to_str().unwrap()));
        assert!(matches!(
            run_config.stats_file_format,
            StatsFileFormat::Json {}
        ));
        assert!(!run_config.watch_config_file);
    }

    #[test]
    fn cli_run_all() {
        let cli_config: ExecConfig = args::try_parse_from([
            "myprog",
            RUN_COMMAND,
            "-d",
            TEST_DIR,
            "-f",
            "json",
            "-o",
            STATS_FILE,
            "-s",
            "json",
            "-t",
            "1s",
            "-w",
            YAML_FILE,
        ])
        .unwrap();
        let ExecConfig::Run(run_config) = cli_config else {
            panic!()
        };
        assert_eq!(run_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(matches!(run_config.output_format, RunOutputFormat::Json));
        assert!(run_config.results_dir.is_some());
        assert_eq!(run_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
        assert!(run_config.start_at.is_some());
        assert_eq!(run_config.start_at.unwrap(), Duration::new(1, 0));
        assert_eq!(
            run_config.stats_file.to_str().unwrap(),
            format!("{}{}", TEST_DIR, STATS_FILE)
        );
        assert!(matches!(
            run_config.stats_file_format,
            StatsFileFormat::Json {}
        ));
        assert!(run_config.watch_config_file);
    }

    #[test]
    fn cli_run_all_long() {
        let cli_config = args::try_parse_from([
            "myprog",
            RUN_COMMAND,
            "--results-directory",
            TEST_DIR,
            "--output-format",
            "json",
            "--stats-file",
            STATS_FILE,
            "--stats-file-format",
            "json",
            "--start-at",
            "1s",
            "--watch",
            YAML_FILE,
        ])
        .unwrap();
        let ExecConfig::Run(run_config) = cli_config else {
            panic!()
        };
        assert_eq!(run_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(matches!(run_config.output_format, RunOutputFormat::Json));
        assert!(run_config.results_dir.is_some());
        assert_eq!(run_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
        assert!(run_config.start_at.is_some());
        assert_eq!(run_config.start_at.unwrap(), Duration::new(1, 0));
        assert_eq!(
            run_config.stats_file.to_str().unwrap(),
            format!("{}{}", TEST_DIR, STATS_FILE)
        );
        assert!(matches!(
            run_config.stats_file_format,
            StatsFileFormat::Json {}
        ));
        assert!(run_config.watch_config_file);
    }

    #[test]
    fn cli_run_format_json() {
        let cli_config =
            args::try_parse_from(["myprog", RUN_COMMAND, "-f", "json", YAML_FILE]).unwrap();
        let ExecConfig::Run(run_config) = cli_config else {
            panic!()
        };
        assert!(matches!(run_config.output_format, RunOutputFormat::Json));
        assert!(!run_config.output_format.is_human());
    }

    #[test]
    fn cli_run_format_human() {
        let cli_config =
            args::try_parse_from(["myprog", RUN_COMMAND, "-f", "human", YAML_FILE]).unwrap();
        let ExecConfig::Run(run_config) = cli_config else {
            panic!()
        };
        assert!(matches!(run_config.output_format, RunOutputFormat::Human));
        assert!(run_config.output_format.is_human());
    }

    #[test]
    fn cli_run_paths() {
        let cli_config = args::try_parse_from([
            "myprog",
            RUN_COMMAND,
            "-d",
            TEST_DIR,
            "-o",
            STATS_FILE,
            YAML_FILE,
        ])
        .unwrap();
        let ExecConfig::Run(run_config) = cli_config else {
            panic!()
        };
        assert_eq!(run_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(run_config.results_dir.is_some());
        assert_eq!(run_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
        assert_eq!(
            run_config.stats_file.to_str().unwrap(),
            format!("{}{}", TEST_DIR, STATS_FILE)
        );
    }

    #[test]
    fn cli_try_simple() {
        let cli_config = args::try_parse_from(["myprog", TRY_COMMAND, YAML_FILE]).unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(try_config.file.is_none());
        assert!(try_config.filters.is_none());
        assert!(matches!(try_config.format, TryRunFormat::Human));
        assert!(!try_config.loggers_on);
        assert!(!try_config.skip_response_body_on);
        assert!(!try_config.skip_request_body_on);
        assert!(try_config.results_dir.is_none());
    }

    #[test]
    fn cli_try_all() {
        let cli_config = args::try_parse_from([
            "myprog",
            TRY_COMMAND,
            "-d",
            TEST_DIR,
            "-f",
            "json",
            "-i",
            "_id=0",
            "-l",
            "-k",
            "-K",
            "-o",
            STATS_FILE,
            YAML_FILE,
        ])
        .unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(try_config.file.is_some());
        assert_eq!(try_config.file.unwrap(), STATS_FILE);
        assert!(try_config.filters.is_some());
        let filters = try_config.filters.unwrap();
        assert_eq!(filters.len(), 1);
        match &filters[0] {
            TryFilter::Eq(key, value) => {
                assert_eq!(key, "_id");
                assert_eq!(value, "0");
            }
            _ => panic!(),
        }
        assert!(matches!(try_config.format, TryRunFormat::Json));
        assert!(try_config.loggers_on);
        assert!(try_config.skip_response_body_on);
        assert!(try_config.skip_request_body_on);
        assert!(try_config.results_dir.is_some());
        assert_eq!(try_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
    }

    #[test]
    fn cli_try_all_long() {
        let cli_config = args::try_parse_from([
            "myprog",
            TRY_COMMAND,
            "--results-directory",
            TEST_DIR,
            "--format",
            "json",
            "--include",
            "_id=0",
            "--loggers",
            "--skip-response-body",
            "--skip-request-body",
            "--file",
            STATS_FILE,
            YAML_FILE,
        ])
        .unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(try_config.file.is_some());
        assert_eq!(try_config.file.unwrap(), STATS_FILE);
        assert!(try_config.filters.is_some());
        let filters = try_config.filters.unwrap();
        assert_eq!(filters.len(), 1);
        match &filters[0] {
            TryFilter::Eq(key, value) => {
                assert_eq!(key, "_id");
                assert_eq!(value, "0");
            }
            _ => panic!(),
        }
        assert!(matches!(try_config.format, TryRunFormat::Json));
        assert!(try_config.loggers_on);
        assert!(try_config.skip_response_body_on);
        assert!(try_config.skip_request_body_on);
        assert!(try_config.results_dir.is_some());
        assert_eq!(try_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
    }

    #[test]
    fn cli_try_skip_response_body() {
        let cli_config =
            args::try_parse_from(["myprog", TRY_COMMAND, "--skip-response-body", YAML_FILE])
                .unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(try_config.skip_response_body_on);
        assert!(!try_config.skip_request_body_on);
    }

    #[test]
    fn cli_try_request_body() {
        let cli_config =
            args::try_parse_from(["myprog", TRY_COMMAND, "--skip-request-body", YAML_FILE])
                .unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(!try_config.skip_response_body_on);
        assert!(try_config.skip_request_body_on);
    }

    #[test]
    fn cli_try_include() {
        let cli_config = args::try_parse_from([
            "myprog",
            TRY_COMMAND,
            "-i",
            "_id=0",
            "-i",
            "_id=1",
            "-f",
            "json",
            YAML_FILE2,
        ])
        .unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE2);
        assert!(try_config.filters.is_some());
        let filters = try_config.filters.unwrap();
        assert_eq!(filters.len(), 2);
        match &filters[0] {
            TryFilter::Eq(key, value) => {
                assert_eq!(key, "_id");
                assert_eq!(value, "0");
            }
            _ => panic!(),
        }
        match &filters[1] {
            TryFilter::Eq(key, value) => {
                assert_eq!(key, "_id");
                assert_eq!(value, "1");
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_include2() {
        let cli_config = args::try_parse_from([
            "myprog",
            TRY_COMMAND,
            YAML_FILE2,
            "-i",
            "_id=0",
            "-i",
            "_id=1",
        ])
        .unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE2);
        assert!(try_config.filters.is_some());
        let filters = try_config.filters.unwrap();
        assert_eq!(filters.len(), 2);
        match &filters[0] {
            TryFilter::Eq(key, value) => {
                assert_eq!(key, "_id");
                assert_eq!(value, "0");
            }
            _ => panic!(),
        }
        match &filters[1] {
            TryFilter::Eq(key, value) => {
                assert_eq!(key, "_id");
                assert_eq!(value, "1");
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_include3() {
        let cli_config = args::try_parse_from([
            "myprog",
            TRY_COMMAND,
            "-i",
            "_id!=0",
            "-i",
            "_id!=1",
            YAML_FILE2,
        ])
        .unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE2);
        assert!(try_config.filters.is_some());
        let filters = try_config.filters.unwrap();
        assert_eq!(filters.len(), 2);
        match &filters[0] {
            TryFilter::Ne(key, value) => {
                assert_eq!(key, "_id");
                assert_eq!(value, "0");
            }
            _ => panic!(),
        }
        match &filters[1] {
            TryFilter::Ne(key, value) => {
                assert_eq!(key, "_id");
                assert_eq!(value, "1");
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_include4() {
        // Verify that the old way doesn't work.
        // Correct is `-i x -i y -i z`, not `-i x y z`
        let cli_config_result = args::try_parse_from([
            "myprog",
            TRY_COMMAND,
            YAML_FILE,
            "--include",
            "_id=0",
            "_id=1",
        ]);
        assert!(cli_config_result.is_err());
        // Ensure that failure is because of missing `--include`
        let cli_config_result = args::try_parse_from([
            "myprog",
            TRY_COMMAND,
            YAML_FILE,
            "--include",
            "_id=0",
            "--include",
            "_id=1",
        ]);
        assert!(cli_config_result.is_ok());
    }

    #[test]
    fn cli_try_format_json() {
        let cli_config =
            args::try_parse_from(["myprog", TRY_COMMAND, "-f", "json", YAML_FILE]).unwrap();

        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert!(matches!(try_config.format, TryRunFormat::Json));
        assert!(!try_config.format.is_human());
    }

    #[test]
    fn cli_try_format_human() {
        let cli_config =
            args::try_parse_from(["myprog", TRY_COMMAND, "-f", "human", YAML_FILE]).unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert!(matches!(try_config.format, TryRunFormat::Human));
        assert!(try_config.format.is_human());
    }

    #[test]
    fn cli_try_paths_no_log() {
        // -d is only enabled with -l
        let cli_config =
            args::try_parse_from(["myprog", TRY_COMMAND, "-d", TEST_DIR, YAML_FILE]).unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(!try_config.loggers_on);
        assert!(try_config.results_dir.is_none());
    }

    #[test]
    fn cli_try_paths() {
        // -d is only enabled with -l
        let cli_config =
            args::try_parse_from(["myprog", TRY_COMMAND, "-l", "-d", TEST_DIR, YAML_FILE]).unwrap();
        let ExecConfig::Try(try_config) = cli_config else {
            panic!()
        };
        assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
        assert!(try_config.loggers_on);
        assert!(try_config.results_dir.is_some());
        assert_eq!(try_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
    }
}
