use std::{
    convert::TryInto,
    fs::create_dir_all,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

use clap::{crate_version, App, AppSettings, Arg, SubCommand};
use futures::{sync::mpsc as futures_channel, Future};
use pewpew::{
    create_run, ExecConfig, RunConfig, StatsFileFormat, TryConfig, TryFilter, TryRunFormat,
};
use regex::Regex;
use tokio::{
    self,
    io::{stderr, stdout},
};
use yansi::Paint;

fn main() {
    #[cfg(target_os = "windows")]
    {
        if !Paint::enable_windows_ascii() {
            Paint::disable();
        }
    }
    if atty::isnt(atty::Stream::Stderr) {
        Paint::disable();
    }
    let filter_reg = Regex::new("^(.*?)(!=|=)(.*)").expect("is a valid regex");
    let filter_reg2 = filter_reg.clone();
    let matches = App::new("pewpew")
        .about("The HTTP load test tool https://fs-eng.github.io/pewpew")
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
                    .help("Watch the config file for changes in load_patterns and peak_loads and update the test accordingly")
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

    let cli_config = if let Some(matches) = matches.subcommand_matches("run") {
        let config_file: PathBuf = matches
            .value_of("CONFIG")
            .expect("should have CONFIG param")
            .into();
        let results_dir = matches.value_of("results-directory");
        let output_format = TryInto::try_into(
            matches
                .value_of("output-format")
                .expect("should have output_format cli arg"),
        )
        .expect("output_format cli arg unrecognized");
        let results_dir = results_dir.map(|d| {
            create_dir_all(d).unwrap();
            d.into()
        });
        let (ctrl_c_tx, ctrlc_channel) = futures_channel::unbounded();

        let _ = ctrlc::set_handler(move || {
            let _ = ctrl_c_tx.unbounded_send(());
        });
        let stats_file_format = StatsFileFormat::Json;
        let watch_config_file = matches.is_present("watch");
        let run_config = RunConfig {
            config_file,
            ctrlc_channel,
            output_format,
            results_dir,
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

    let f = create_run(cli_config, stdout, stderr)
        .map_err(|_| HAD_FATAL_ERROR.store(true, Ordering::Relaxed));
    tokio::run(f);

    if HAD_FATAL_ERROR.load(Ordering::Relaxed) {
        std::process::exit(1)
    }
}

static HAD_FATAL_ERROR: AtomicBool = AtomicBool::new(false);
