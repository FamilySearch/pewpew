use std::{
    env,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use futures::Future;

#[test]
fn int1() {
    let port = test_common::start_test_server();
    env::set_var("PORT", port.to_string());

    let run_config = pewpew::RunConfig {
        config_file: "tests/integration.yaml".into(),
        output_format: pewpew::RunOutputFormat::Human,
        results_dir: "./".into(),
        stats_file_format: pewpew::StatsFileFormat::Json,
    };
    let exec_config = pewpew::ExecConfig::Run(run_config);

    let stdout = test_common::TestWriter::new();
    let stderr = test_common::TestWriter::new();

    let stdout2 = stdout.clone();
    let stderr2 = stderr.clone();

    let get_stdout = move || stdout.clone();
    let get_stderr = move || stderr.clone();

    let did_succeed = Arc::new(AtomicBool::new(false));
    let did_succeed2 = did_succeed.clone();

    let future = pewpew::create_run(exec_config, get_stdout, get_stderr)
        .map(move |_| did_succeed.store(true, Ordering::Relaxed));
    tokio::run(future);

    let stdout = stdout2.get_string();
    let stderr = stderr2.get_string();

    assert!(
        did_succeed2.load(Ordering::Relaxed),
        "test run failed. {}",
        stderr
    );

    let left = stdout;
    let right = include_str!("integration.stdout.out");
    assert_eq!(left, right);
}
