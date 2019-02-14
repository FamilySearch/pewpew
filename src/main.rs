#![feature(bind_by_move_pattern_guards, drain_filter, no_more_cas)]
#![type_length_limit = "2097152"]

mod body_reader;
mod channel;
mod config;
mod error;
mod for_each_parallel;
mod load_test;
mod mod_interval;
mod providers;
mod request;
mod stats;
mod util;
mod zip_all;

use std::{fs::File, path::PathBuf};

use crate::error::TestError;
use crate::load_test::LoadTest;
use crate::util::Either3;

use clap::{crate_version, App, Arg};
use futures::{
    future::{lazy, IntoFuture},
    sync::mpsc as futures_channel,
    Future, Sink,
};
use serde_yaml;
use tokio;
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
    let try_run = matches.value_of("TRY").map(|s| s.to_string());
    tokio::run(lazy(move || {
        let file = match File::open(&load_test_config_file) {
            Ok(f) => f,
            Err(_) => {
                let e = TestError::InvalidConfigFilePath(load_test_config_file);
                print_test_error_to_console(e);
                return Either3::B(Ok(()).into_future());
            }
        };
        let config = match serde_yaml::from_reader(file) {
            Ok(c) => c,
            Err(e) => {
                let e = TestError::YamlDeserializerErr(e.into());
                print_test_error_to_console(e);
                return Either3::B(Ok(()).into_future());
            }
        };
        let (test_ended_tx, test_ended_rx) = futures_channel::channel(0);
        let load_test = LoadTest::new(
            config,
            load_test_config_file,
            (test_ended_tx.clone(), test_ended_rx),
            try_run,
        );
        match load_test {
            Ok(l) => Either3::A(l.run()),
            Err(e) => {
                print_test_error_to_console(e);
                // we send the test_ended message as Ok so if the stats monitor
                // is running it won't reprint the error message
                Either3::C(test_ended_tx.send(Ok(())).then(|_| Ok(())))
            }
        }
    }));
}

pub fn print_test_error_to_console(e: TestError) {
    match e {
        TestError::KilledByLogger => {
            eprintln!("\n{}", Paint::yellow("Test killed early by logger").bold())
        }
        _ => {
            eprintln!("\n{} {}", Paint::red("Fatal test error").bold(), e);
        }
    }
}
