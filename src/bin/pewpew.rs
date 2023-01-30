use std::{
    convert::TryInto,
    ffi::OsString,
    fs::create_dir_all,
    io,
    path::PathBuf,
    time::{Duration, UNIX_EPOCH},
};

use clap::{builder::ValueParser, crate_version, Arg, ArgMatches, Command};
use config::duration_from_string;
use futures::channel::mpsc as futures_channel;
use log::{debug, info};
use pewpew::{
    create_run, ExecConfig, RunConfig, RunOutputFormat, StatsFileFormat, TryConfig, TryFilter,
    TryRunFormat,
};
use regex::Regex;
use tokio::runtime;
use yansi::Paint;

fn get_filter_reg() -> Regex {
    Regex::new("^(.*?)(!=|=)(.*)").expect("is a valid regex")
}

fn parse_duration(arg: &str) -> Result<Duration, config::Error> {
    duration_from_string(arg.into())
}

fn parse_filter(arg: &str) -> Result<String, &'static str> {
    let filter_reg2: Regex = get_filter_reg();
    if filter_reg2.is_match(arg) {
        Ok(arg.to_string())
    } else {
        Err("include filters must be in the format `tag=value` or `tag!=value`")
    }
}

fn get_arg_matcher() -> clap::Command {
    Command::new("pewpew")
        .about("The HTTP load test tool https://familysearch.github.io/pewpew")
        .version(crate_version!())
        .disable_help_subcommand(true)
        .infer_subcommands(true)
        .subcommand_required(true)
        .arg_required_else_help(true)
        // .setting(AppSettings::VersionlessSubcommands)
        .subcommand(Command::new("run")
            .about("Runs a full load test")
            // .setting(AppSettings::UnifiedHelpMessage) // Now the default
            .arg(
                Arg::new("output-format")
                    .short('f')
                    .long("output-format")
                    .help("Formatting for stats printed to stderr")
                    .value_name("FORMAT")
                    .value_parser(["human","json"])
                    .default_value("human")
            )
            .arg(
                Arg::new("stats-file")
                    .short('o')
                    .long("stats-file")
                    .help("Specify the filename for the stats file")
                    .value_name("STATS_FILE")
                    .value_parser(ValueParser::os_string())
            )
            .arg(
                Arg::new("start-at")
                    .short('t')
                    .long("start-at")
                    .help("Specify the time the test should start at")
                    .value_name("START_AT")
                    .value_parser(parse_duration)
            )
            .arg(
                Arg::new("results-directory")
                    .short('d')
                    .long("results-directory")
                    .number_of_values(1)
                    .help("Directory to store results and logs")
                    .value_name("DIRECTORY")
                    .value_parser(ValueParser::os_string())
            )
            .arg(
                Arg::new("stats-file-format")
                    .short('s')
                    .long("stats-file-format")
                    .help("Format for the stats file")
                    .value_name("FORMAT")
                    .value_parser(["json"])
                    // .value_parser(["json", "html", "none"])
                    .default_value("json")
            )
            .arg(
                Arg::new("watch")
                    .short('w')
                    .long("watch")
                    .help("Watch the config file for changes and update the test accordingly")
                    .action(clap::ArgAction::SetTrue)
            )
            .arg(
                Arg::new("CONFIG")
                    .help("Load test config file to use")
                    .required(true)
                    .value_parser(ValueParser::os_string()),
            )
        )
        .subcommand(Command::new("try")
            .about("Runs the specified endpoint(s) a single time for testing purposes")
            // .setting(AppSettings::UnifiedHelpMessage) // Now the default
            .arg(
                Arg::new("loggers")
                    .short('l')
                    .long("loggers")
                    .help("Enable loggers defined in the config file")
                    .action(clap::ArgAction::SetTrue)
            )
            .arg(
                Arg::new("file")
                    .short('o')
                    .long("file")
                    .help("Send results to the specified file instead of stdout")
                    .value_name("FILE")
            )
            .arg(
                Arg::new("format")
                    .short('f')
                    .long("format")
                    .help("Specify the format for the try run output")
                    .value_name("FORMAT")
                    .value_parser(["human","json"])
                    .default_value("human")
            )
            .arg(
                Arg::new("include")
                    .short('i')
                    .long("include")
                    .long_help(r#"Filter which endpoints are included in the try run. Filters work based on an endpoint's tags. Filters are specified in the format "key=value" where "*" is a wildcard. Any endpoint matching the filter is included in the test"#)
                    // .multiple_occurrences(true)
                    // https://github.com/clap-rs/clap/issues/2688
                    // https://github.com/clap-rs/clap/blob/master/CHANGELOG.md#400---2022-09-28
                    // There is no option for multiple '-i x -i y -i z' anymore. The only option is '-i x y z'
                    // Unfortunately this means you can no longer do 'pewpew try -i x y z test.yaml'
                    // since it will try to parse test.yaml as an include. -i must either be last, or be followed by another - parameter
                    .num_args(1..)
                    .value_parser(parse_filter)
                    .value_name("INCLUDE")
            )
            .arg(
                Arg::new("results-directory")
                    .short('d')
                    .long("results-directory")
                    .number_of_values(1)
                    .help("Directory to store logs (if enabled with --loggers)")
                    .value_name("DIRECTORY")
                    .value_parser(ValueParser::os_string())
            )
            .arg(
                Arg::new("CONFIG")
                    .help("Load test config file to use")
                    .required(true)
                    .value_parser(ValueParser::os_string()),
            )
        )
}

fn get_cli_config(matches: ArgMatches) -> ExecConfig {
    let filter_reg: Regex = get_filter_reg();
    if let Some(matches) = matches.subcommand_matches("run") {
        let config_file: PathBuf = matches
            .get_one::<OsString>("CONFIG")
            .expect("should have CONFIG param")
            // .as_str()
            .into();
        let results_dir: Option<PathBuf> =
            matches
                .get_one::<OsString>("results-directory")
                .map(|d: &OsString| {
                    create_dir_all(d).unwrap();
                    PathBuf::from(d)
                });
        let output_format: RunOutputFormat = TryInto::try_into(
            matches
                .get_one::<String>("output-format")
                .expect("should have output_format cli arg")
                .as_str(),
        )
        .expect("output_format cli arg unrecognized");
        let stats_file: PathBuf = matches
            .get_one::<OsString>("stats-file")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let start_sec = UNIX_EPOCH
                    .elapsed()
                    .map(|d| d.as_secs())
                    .unwrap_or_default();
                let test_name = config_file.file_stem().and_then(std::ffi::OsStr::to_str);
                let file = if let Some(test_name) = test_name {
                    format!("stats-{test_name}-{start_sec}.json")
                } else {
                    format!("stats-{start_sec}.json")
                };
                PathBuf::from(file)
            });
        let stats_file = if let Some(results_dir) = &results_dir {
            let mut file = results_dir.clone();
            file.push(stats_file);
            file
        } else {
            stats_file
        };
        let stats_file_format = StatsFileFormat::Json;
        let watch_config_file = matches.get_flag("watch");
        let start_at = matches
            .get_one::<Duration>("start-at")
            .map(|d| d.to_owned());
        let run_config = RunConfig {
            config_file,
            output_format,
            results_dir,
            start_at,
            stats_file,
            stats_file_format,
            watch_config_file,
        };
        ExecConfig::Run(run_config)
    } else if let Some(matches) = matches.subcommand_matches("try") {
        let config_file: PathBuf = matches
            .get_one::<OsString>("CONFIG")
            .expect("should have CONFIG param")
            .into();
        let results_dir = matches
            .get_one::<OsString>("results-directory")
            .map(|s| s.as_os_str());
        let loggers_on = matches.get_flag("loggers");
        let results_dir = match (results_dir, loggers_on) {
            (Some(d), true) => {
                create_dir_all(d).unwrap();
                Some(d.into())
            }
            _ => None,
        };
        let filters = matches.get_many::<String>("include").map(|v| {
            v.map(|s| {
                let s = s.as_str();
                let captures = filter_reg
                    .captures(s)
                    .expect("include cli arg should match regex");
                let left = captures
                    .get(1)
                    .expect("include arg should match regex")
                    .as_str()
                    .to_string();
                let right = captures
                    .get(3)
                    .expect("include arg should match regex")
                    .as_str()
                    .to_string();
                let comparator = captures
                    .get(2)
                    .expect("include arg should match regex")
                    .as_str();
                match comparator {
                    "=" => TryFilter::Eq(left, right),
                    "!=" => TryFilter::Ne(left, right),
                    _ => unreachable!(),
                }
            })
            .collect()
        });
        let format: TryRunFormat = matches
            .get_one::<String>("format")
            .and_then(|f| f.as_str().try_into().ok())
            .unwrap_or_default();
        let file = matches.get_one::<String>("file").map(Into::into);
        let try_config = TryConfig {
            config_file,
            file,
            filters,
            format,
            loggers_on,
            results_dir,
        };
        ExecConfig::Try(try_config)
    } else {
        unreachable!();
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    {
        if !Paint::enable_windows_ascii() {
            Paint::disable();
        }
    }
    // TODO: https://rustsec.org/advisories/RUSTSEC-2021-0145
    // Consider
    //  - [is-terminal](https://crates.io/crates/is-terminal)
    //  - std::io::IsTerminal *nightly-only experimental*
    if atty::isnt(atty::Stream::Stdout) {
        Paint::disable();
    }
    let matches = get_arg_matcher().get_matches();

    let (ctrl_c_tx, ctrlc_channel) = futures_channel::unbounded();

    let _ = ctrlc::set_handler(move || {
        let _ = ctrl_c_tx.unbounded_send(());
    });

    let cli_config = get_cli_config(matches);
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

    let f = create_run(cli_config, ctrlc_channel, io::stdout(), io::stderr());

    let rt = runtime::Builder::new_multi_thread()
        .enable_time()
        .enable_io()
        .thread_name("pewpew-worker")
        .build()
        .unwrap();
    debug!("rt.block_on start");
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
    use std::time::Duration;

    use super::*;

    static RUN_COMMAND: &str = "run";
    static TRY_COMMAND: &str = "try";
    static YAML_FILE: &str = "./tests/integration.yaml";
    static YAML_FILE2: &str = "./tests/int_on_demand.yaml";
    static TEST_DIR: &str = "./tests/";
    static STATS_FILE: &str = "stats-paths.json";

    #[test]
    fn cli_run_simple() {
        let matches = get_arg_matcher()
            .try_get_matches_from(["myprog", RUN_COMMAND, YAML_FILE])
            .unwrap();
        assert_eq!(matches.subcommand_name().unwrap(), RUN_COMMAND);

        let stats_regex = Regex::new(r"^stats-integration-\d+\.json$").unwrap();
        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Run(run_config) => {
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
            _ => panic!(),
        }
    }

    #[test]
    fn cli_run_all() {
        let matches = get_arg_matcher()
            .try_get_matches_from([
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
        assert_eq!(matches.subcommand_name().unwrap(), RUN_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Run(run_config) => {
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
            _ => panic!(),
        }
    }

    #[test]
    fn cli_run_all_long() {
        let matches = get_arg_matcher()
            .try_get_matches_from([
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
        assert_eq!(matches.subcommand_name().unwrap(), RUN_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Run(run_config) => {
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
            _ => panic!(),
        }
    }

    #[test]
    fn cli_run_format_json() {
        let matches = get_arg_matcher()
            .try_get_matches_from(["myprog", RUN_COMMAND, "-f", "json", YAML_FILE])
            .unwrap();

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Run(run_config) => {
                assert!(matches!(run_config.output_format, RunOutputFormat::Json));
                assert!(!run_config.output_format.is_human());
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_run_format_human() {
        let matches = get_arg_matcher()
            .try_get_matches_from(["myprog", RUN_COMMAND, "-f", "human", YAML_FILE])
            .unwrap();

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Run(run_config) => {
                assert!(matches!(run_config.output_format, RunOutputFormat::Human));
                assert!(run_config.output_format.is_human());
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_run_paths() {
        let matches = get_arg_matcher()
            .try_get_matches_from([
                "myprog",
                RUN_COMMAND,
                "-d",
                TEST_DIR,
                "-o",
                STATS_FILE,
                YAML_FILE,
            ])
            .unwrap();
        assert_eq!(matches.subcommand_name().unwrap(), RUN_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Run(run_config) => {
                assert_eq!(run_config.config_file.to_str().unwrap(), YAML_FILE);
                assert!(run_config.results_dir.is_some());
                assert_eq!(run_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
                assert_eq!(
                    run_config.stats_file.to_str().unwrap(),
                    format!("{}{}", TEST_DIR, STATS_FILE)
                );
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_simple() {
        let matches = get_arg_matcher()
            .try_get_matches_from(["myprog", TRY_COMMAND, YAML_FILE])
            .unwrap();
        assert_eq!(matches.subcommand_name().unwrap(), TRY_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Try(try_config) => {
                assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
                assert!(try_config.file.is_none());
                assert!(try_config.filters.is_none());
                assert!(matches!(try_config.format, TryRunFormat::Human));
                assert!(!try_config.loggers_on);
                assert!(try_config.results_dir.is_none());
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_all() {
        let matches = get_arg_matcher()
            .try_get_matches_from([
                "myprog",
                TRY_COMMAND,
                "-d",
                TEST_DIR,
                "-f",
                "json",
                "-i",
                "_id=0",
                "-l",
                "-o",
                STATS_FILE,
                YAML_FILE,
            ])
            .unwrap();
        assert_eq!(matches.subcommand_name().unwrap(), TRY_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Try(try_config) => {
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
                assert!(try_config.results_dir.is_some());
                assert_eq!(try_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_all_long() {
        let matches = get_arg_matcher()
            .try_get_matches_from([
                "myprog",
                TRY_COMMAND,
                "--results-directory",
                TEST_DIR,
                "--format",
                "json",
                "--include",
                "_id=0",
                "--loggers",
                "--file",
                STATS_FILE,
                YAML_FILE,
            ])
            .unwrap();
        assert_eq!(matches.subcommand_name().unwrap(), TRY_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Try(try_config) => {
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
                assert!(try_config.results_dir.is_some());
                assert_eq!(try_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_include() {
        let matches = get_arg_matcher()
            .try_get_matches_from([
                "myprog",
                TRY_COMMAND,
                "-i",
                "_id=0",
                "_id=1",
                "-f",
                "json",
                YAML_FILE2,
            ])
            .unwrap();
        assert_eq!(matches.subcommand_name().unwrap(), TRY_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Try(try_config) => {
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
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_include2() {
        let matches = get_arg_matcher()
            .try_get_matches_from(["myprog", TRY_COMMAND, YAML_FILE2, "-i", "_id=0", "_id=1"])
            .unwrap();
        assert_eq!(matches.subcommand_name().unwrap(), TRY_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Try(try_config) => {
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
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_format_json() {
        let matches = get_arg_matcher()
            .try_get_matches_from(["myprog", TRY_COMMAND, "-f", "json", YAML_FILE])
            .unwrap();

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Try(try_config) => {
                assert!(matches!(try_config.format, TryRunFormat::Json));
                assert!(!try_config.format.is_human());
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_format_human() {
        let matches = get_arg_matcher()
            .try_get_matches_from(["myprog", TRY_COMMAND, "-f", "human", YAML_FILE])
            .unwrap();

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Try(try_config) => {
                assert!(matches!(try_config.format, TryRunFormat::Human));
                assert!(try_config.format.is_human());
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_paths_no_log() {
        // -d is only enabled with -l
        let matches = get_arg_matcher()
            .try_get_matches_from(["myprog", TRY_COMMAND, "-d", TEST_DIR, YAML_FILE])
            .unwrap();
        assert_eq!(matches.subcommand_name().unwrap(), TRY_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Try(try_config) => {
                assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
                assert!(!try_config.loggers_on);
                assert!(try_config.results_dir.is_none());
            }
            _ => panic!(),
        }
    }

    #[test]
    fn cli_try_paths() {
        // -d is only enabled with -l
        let matches = get_arg_matcher()
            .try_get_matches_from(["myprog", TRY_COMMAND, "-l", "-d", TEST_DIR, YAML_FILE])
            .unwrap();
        assert_eq!(matches.subcommand_name().unwrap(), TRY_COMMAND);

        let cli_config: ExecConfig = get_cli_config(matches);
        match cli_config {
            ExecConfig::Try(try_config) => {
                assert_eq!(try_config.config_file.to_str().unwrap(), YAML_FILE);
                assert!(try_config.loggers_on);
                assert!(try_config.results_dir.is_some());
                assert_eq!(try_config.results_dir.unwrap().to_str().unwrap(), TEST_DIR);
            }
            _ => panic!(),
        }
    }
}
