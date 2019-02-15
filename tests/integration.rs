use std::process::Command;

use assert_cmd::prelude::*;

mod common;

#[test]
fn int1() {
    common::start_test_server();
    let out = Command::cargo_bin(env!("CARGO_PKG_NAME"))
        .unwrap()
        .arg("tests/integration.yaml")
        .output()
        .unwrap();

    let stdout = std::str::from_utf8(&out.stdout).unwrap();
    assert_eq!(stdout, "true\ntrue\n");
}
