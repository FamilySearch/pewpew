#![feature(drain_filter, no_more_cas, pin)]

mod channel;
mod config;
mod for_each_parallel;
mod load_test;
mod mod_interval;
mod providers;
mod request;
mod stats;
mod template;
mod zip_all;

use std::fs::File;

use clap::{App, Arg, crate_version};
use crate::config::Config;
use crate::load_test::LoadTest;
use futures::future::lazy;
use serde_yaml;
use tokio;

fn main() {
    #[cfg(target_os = "windows")]
    {
        let _ = ansi_term::enable_ansi_support();
    }
    let matches = App::new("pewpew")
        .version(crate_version!())
        .arg(Arg::with_name("CONFIG")
            .help("the load test config file to use")
            .index(1)
            .default_value("loadtest.yaml")
        ).get_matches();
    let load_test_config_file = matches.value_of("CONFIG").unwrap().to_string();
    tokio::run(lazy(move || {
        let file = File::open(&load_test_config_file).unwrap_or_else(|_| panic!("error opening `{}`", load_test_config_file));
        let config: Config = serde_yaml::from_reader(file).expect("couldn't parse yaml");
        LoadTest::new(config).run()
    }));
}