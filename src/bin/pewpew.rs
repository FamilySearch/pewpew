use std::{convert::TryInto, fs::create_dir_all, io, path::PathBuf, time::UNIX_EPOCH};

use clap::{crate_version, App, AppSettings, Arg, SubCommand};
use config::duration_from_string;
use futures::channel::mpsc as futures_channel;
use pewpew::{
    create_run, ExecConfig, RunConfig, StatsFileFormat, TryConfig, TryFilter, TryRunFormat,
};
use regex::Regex;
use tokio::runtime;
use yansi::Paint;

fn main() {
    #[cfg(target_os = "windows")]
    {
        if !Paint::enable_windows_ascii() {
            Paint::disable();
        }
    }
    if atty::isnt(atty::Stream::Stdout) {
        Paint::disable();
    }
    let filter_reg = Regex::new("^(.*?)(!=|=)(.*)").expect("is a valid regex");
    let filter_reg2 = filter_reg.clone();
    let matches = App::new("pewpew")
        .about("The HTTP load test tool https://familysearch.github.io/pewpew")
        .version(crate_version!())
        .setting(AppSettings::DisableHelpSubcommand)
        // .setting(AppSettings::InferSubcommands) // disabled until https://github.com/clap-rs/clap/issues/1463 is fixed
        .setting(AppSettings::SubcommandRequiredElseHelp)
        .setting(AppSettings::VersionlessSubcommands)
        .subcommand(SubCommand::with_name("run")
            .about("Runs a full load test")
            .setting(AppSettings::UnifiedHelpMessage)
            .arg(
                Arg::with_name("output-format")
                    .short("f")
                    .long("output-format")
                    .help("Formatting for stats printed to stderr")
                    .value_name("FORMAT")
                    .possible_value("human")
                    .possible_value("json")
                    .default_value("human")
            )
            .arg(
                Arg::with_name("stats-file")
                    .short("o")
                    .long("stats-file")
                    .help("Specify the filename for the stats file")
                    .value_name("STATS_FILE")
            )
            .arg(
                Arg::with_name("start-at")
                    .short("t")
                    .long("start-at")
                    .help("Specify the time the test should start at")
                    .value_name("START_AT")
                    .validator(|s| {
                        match duration_from_string(s) {
                            Ok(_) => Ok(()),
                            Err(_) => Err("".into()),
                        }
                    })
            )
            .arg(
                Arg::with_name("results-directory")
                    .short("d")
                    .long("results-directory")
                    .number_of_values(1)
                    .help("Directory to store results and logs")
                    .value_name("DIRECTORY")
            )
            .arg(
                Arg::with_name("stats-file-format")
                    .short("s")
                    .long("stats-file-format")
                    .help("Format for the stats file")
                    .value_name("FORMAT")
                    .possible_value("json")
                    // .possible_value("html")
                    // .possible_value("none")
                    .default_value("json")
            )
            .arg(
                Arg::with_name("watch")
                    .short("w")
                    .long("watch")
                    .help("Watch the config file for changes and update the test accordingly")
            )
            .arg(
                Arg::with_name("CONFIG")
                    .help("Load test config file to use")
                    .required(true),
            )
        )
        .subcommand(SubCommand::with_name("try")
            .about("Runs the specified endpoint(s) a single time for testing purposes")
            .setting(AppSettings::UnifiedHelpMessage)
            .arg(
                Arg::with_name("loggers")
                    .short("l")
                    .long("loggers")
                    .help("Enable loggers defined in the config file")
            )
            .arg(
                Arg::with_name("file")
                    .short("o")
                    .long("file")
                    .help("Send results to the specified file instead of stderr")
                    .value_name("FILE")
            )
            .arg(
                Arg::with_name("format")
                    .short("f")
                    .long("format")
                    .help("Specify the format for the try run output")
                    .value_name("FORMAT")
                    .possible_value("human")
                    .possible_value("json")
                    .default_value("human")
            )
            .arg(
                Arg::with_name("include")
                    .short("i")
                    .long("include")
                    .long_help(r#"Filter which endpoints are included in the try run. Filters work based on an endpoint's tags. Filters are specified in the format "key=value" where "*" is a wildcard. Any endpoint matching the filter is included in the test"#)
                    .multiple(true)
                    .number_of_values(1)
                    .validator(move |s| {
                        if filter_reg2.is_match(&s) {
                            Ok(())
                        } else {
                            Err("include filters must be in the format `tag=value` or `tag!=value`".to_string())
                        }
                    })
                    .value_name("INCLUDE")
            )
            .arg(
                Arg::with_name("results-directory")
                    .short("d")
                    .long("results-directory")
                    .number_of_values(1)
                    .help("Directory to store logs (if enabled with --loggers)")
                    .value_name("DIRECTORY")
            )
            .arg(
                Arg::with_name("CONFIG")
                    .help("Load test config file to use")
                    .required(true),
            )
        )
        .get_matches();

    let (ctrl_c_tx, ctrlc_channel) = futures_channel::unbounded();

    let _ = ctrlc::set_handler(move || {
        let _ = ctrl_c_tx.unbounded_send(());
    });

    let cli_config = if let Some(matches) = matches.subcommand_matches("run") {
        let config_file: PathBuf = matches
            .value_of("CONFIG")
            .expect("should have CONFIG param")
            .into();
        let results_dir = matches.value_of_os("results-directory").map(|d| {
            create_dir_all(d).unwrap();
            PathBuf::from(d)
        });
        let output_format = TryInto::try_into(
            matches
                .value_of("output-format")
                .expect("should have output_format cli arg"),
        )
        .expect("output_format cli arg unrecognized");
        let stats_file = matches
            .value_of_os("stats-file")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let start_sec = UNIX_EPOCH
                    .elapsed()
                    .map(|d| d.as_secs())
                    .unwrap_or_default();
                let test_name = config_file.file_stem().and_then(std::ffi::OsStr::to_str);
                let file = if let Some(test_name) = test_name {
                    format!("stats-{}-{}.json", test_name, start_sec)
                } else {
                    format!("stats-{}.json", start_sec)
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
        let watch_config_file = matches.is_present("watch");
        let start_at = matches
            .value_of("start-at")
            .map(|s| duration_from_string(s.to_string()).expect("start_at should match pattern"));
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
            .value_of("CONFIG")
            .expect("should have CONFIG param")
            .into();
        let results_dir = matches.value_of("results-directory");
        let loggers_on = matches.is_present("loggers");
        let results_dir = match (results_dir, loggers_on) {
            (Some(d), true) => {
                create_dir_all(d).unwrap();
                Some(d.into())
            }
            _ => None,
        };
        let filters = matches.values_of("include").map(|v| {
            v.map(|s| {
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
            .value_of("format")
            .and_then(|f| f.try_into().ok())
            .unwrap_or_default();
        let file = matches.value_of("file").map(Into::into);
        let try_config = TryConfig {
            loggers_on,
            file,
            filters,
            format,
            config_file,
            results_dir,
        };
        ExecConfig::Try(try_config)
    } else {
        unreachable!();
    };

    let f = create_run(cli_config, ctrlc_channel, io::stdout(), io::stderr());

    let mut rt = runtime::Builder::new()
        .threaded_scheduler()
        .enable_time()
        .enable_io()
        .thread_name("pewpew-worker")
        .build()
        .unwrap();
    let result = rt.block_on(f);
    // shutdown the runtime in case there are any hanging threads/tasks
    rt.shutdown_timeout(Default::default());

    if result.is_err() {
        std::process::exit(1)
    }
}
