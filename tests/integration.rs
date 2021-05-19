use std::env;

use futures::FutureExt;
use test_common::{start_test_server, TestWriter};
use tokio::runtime::Runtime;

fn run_test(path: &str) -> (bool, String, String) {
    let rt = Runtime::new().unwrap();
    rt.block_on(async move {
        let (port, kill_server, _) = start_test_server(None);
        env::set_var("PORT", port.to_string());

        let (_, ctrlc_channel) = futures::channel::mpsc::unbounded();

        let run_config = pewpew::RunConfig {
            config_file: path.into(),
            output_format: pewpew::RunOutputFormat::Human,
            results_dir: Some("./".into()),
            stats_file: "integration.json".into(),
            stats_file_format: pewpew::StatsFileFormat::Json,
            start_at: None,
            watch_config_file: true,
        };
        let exec_config = pewpew::ExecConfig::Run(run_config);

        let stdout = TestWriter::new();
        let stderr = TestWriter::new();

        let stdout2 = stdout.clone();
        let stderr2 = stderr.clone();

        let success = pewpew::create_run(exec_config, ctrlc_channel, stdout, stderr)
            .map(|r| if r.is_ok() { true } else { false })
            .await;

        let _ = kill_server.send(());

        (success, stdout2.get_string(), stderr2.get_string())
    })
}

#[test]
fn int1() {
    let (success, _stdin, stderr) = run_test("tests/integration.yaml");

    assert!(success, "test run failed. {}", stderr);

    let left = stderr;
    let right = include_str!("integration.stderr.out");
    assert_eq!(left, right);
}

#[test]
fn int_on_demand() {
    let (success, _stdin, stderr) = run_test("tests/int_on_demand.yaml");

    assert!(success, "test run failed. {}", stderr);

    assert!(
        stderr.len() > 0,
        "expected stderr to be a bunch of '1'. Instead saw: {}",
        stderr
    );

    for line in stderr.lines() {
        assert_eq!(
            line, "1",
            "expected stderr to be a bunch of '1'. Instead saw: {}",
            stderr
        );
    }
}
