use std::process::Command;

use assert_cmd::prelude::*;

mod common;

#[test]
fn int1() {
    let port = common::start_test_server();
    let out = Command::cargo_bin(env!("CARGO_PKG_NAME"))
        .expect("error calling cargo_bin")
        .env("PORT", port.to_string())
        .arg("tests/integration.yaml")
        .output()
        .expect("could not execute integration test");

    assert!(out.status.success(), "process had a non-zero exit status. Stderr: {}", std::str::from_utf8(&out.stderr).unwrap());

    let left = std::str::from_utf8(&out.stdout).expect("could not parse stdout as string");
    let right = include_str!("integration.stdout.out");
    assert_eq!(left, right);
}
