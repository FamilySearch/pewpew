#![recursion_limit = "128"]
use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

use pewpew::create_run;

use clap::{crate_version, App, Arg};
use futures::Future;
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
    let matches = App::new("pewpew")
        .version(crate_version!())
        .arg(
            Arg::with_name("CONFIG")
                .help("the load test config file to use")
                .index(1)
                .default_value("loadtest.yaml")
                .required(true),
        )
        .arg(
            Arg::with_name("TRY")
                .help("the alias name of a single endpoint which will be run a single time with the raw http request and response printed to STDOUT")
                .index(2),
        )
        .get_matches();
    let load_test_config_file: PathBuf = matches
        .value_of("CONFIG")
        .expect("should have CONFIG param")
        .into();

    let test_run = matches.value_of("TRY").map(ToString::to_string);
    let f = create_run(load_test_config_file, test_run, stdout, stderr)
        .map_err(|_| HAD_FATAL_ERROR.store(true, Ordering::Relaxed));
    tokio::run(f);

    if HAD_FATAL_ERROR.load(Ordering::Relaxed) {
        std::process::exit(1)
    }
}

static HAD_FATAL_ERROR: AtomicBool = AtomicBool::new(false);
