#![feature(drain_filter, no_more_cas, pin, tool_lints)]

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

use crate::config::Config;
use crate::load_test::LoadTest;
use futures::future::lazy;
use serde_yaml;
use tokio;

fn main() {
    tokio::run(lazy(|| {
        let file = File::open("config.yaml").expect("error opening config.yaml");
        let config: Config = serde_yaml::from_reader(file).expect("couldn't parse yaml");
        LoadTest::new(config).run()
    }));
}