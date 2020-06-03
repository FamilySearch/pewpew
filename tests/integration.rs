use std::{
    env,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use futures::FutureExt;
use tokio::runtime::Runtime;

#[test]
fn int1() {
    let (port, _) = test_common::start_test_server(None);
    env::set_var("PORT", port.to_string());

    let (_, ctrlc_channel) = futures::channel::mpsc::unbounded();

    let run_config = pewpew::RunConfig {
        config_file: "tests/integration.yaml".into(),
        output_format: pewpew::RunOutputFormat::Human,
        results_dir: Some("./".into()),
        stats_file: "integration.json".into(),
        stats_file_format: pewpew::StatsFileFormat::Json,
        start_at: None,
        watch_config_file: false,
    };
    let exec_config = pewpew::ExecConfig::Run(run_config);

    let stdout = test_common::TestWriter::new();
    let stderr = test_common::TestWriter::new();

    let stdout2 = stdout.clone();
    let stderr2 = stderr.clone();

    let did_succeed = Arc::new(AtomicBool::new(false));
    let did_succeed2 = did_succeed.clone();

    let future = pewpew::create_run(exec_config, ctrlc_channel, stdout, stderr)
        .map(move |_| did_succeed.store(true, Ordering::Relaxed));
    let mut rt = Runtime::new().unwrap();
    rt.block_on(future);

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
