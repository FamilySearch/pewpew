#![feature(drain_filter, existential_type, no_more_cas, impl_trait_in_bindings)]

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
use crate::util::Either;

use ansi_term::Color;
use clap::{crate_version, App, Arg};
use futures::future::{lazy, IntoFuture};
use serde_yaml;
use tokio;

fn main() {
    #[cfg(target_os = "windows")]
    {
        let _ = ansi_term::enable_ansi_support();
    }
    let matches = App::new("pewpew")
        .version(crate_version!())
        .arg(
            Arg::with_name("CONFIG")
                .help("the load test config file to use")
                .index(1)
                .default_value("loadtest.yaml"),
        )
        .get_matches();
    let load_test_config_file: PathBuf = matches
        .value_of("CONFIG")
        .expect("should have CONFIG param")
        .into();
    tokio::run(lazy(move || {
        let file = match File::open(&load_test_config_file) {
            Ok(f) => f,
            Err(_) => {
                let e = TestError::InvalidConfigFilePath(load_test_config_file);
                print_test_error_to_console(e);
                return Either::B(Ok(()).into_future());
            }
        };
        let config = match serde_yaml::from_reader(file) {
            Ok(c) => c,
            Err(e) => {
                let e = TestError::YamlDeserializerErr(e.into());
                print_test_error_to_console(e);
                return Either::B(Ok(()).into_future());
            }
        };
        let load_test = LoadTest::new(config, load_test_config_file);
        match load_test {
            Ok(l) => Either::A(l.run()),
            Err(e) => {
                print_test_error_to_console(e);
                Either::B(Ok(()).into_future())
            }
        }
    }));
}

pub fn print_test_error_to_console(e: TestError) {
    match e {
        TestError::KilledByLogger => eprint!(
            "\n{}\n",
            Color::Yellow.bold().paint("Test killed early by logger")
        ),
        _ => {
            eprintln!("\n{} {}\n", Color::Red.bold().paint("Fatal test error"), e);
        }
    }
}
