use std::env;

use test_common::{start_test_server, TestWriter};
use tokio::runtime::Runtime;

fn run_test(
    path: &str,
) -> (
    Result<pewpew::TestEndReason, pewpew::TestError>,
    String,
    String,
) {
    let rt = Runtime::new().unwrap();
    rt.block_on(async move {
        let (port, kill_server, _) = start_test_server(None).await;
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

        let result = pewpew::create_run(exec_config, ctrlc_channel, stdout, stderr).await;

        let _ = kill_server.send(());

        (result, stdout2.get_string(), stderr2.get_string())
    })
}

#[test]
fn int1() {
    let (result, _stdin, stderr) = run_test("tests/integration.yaml");

    assert!(result.is_ok(), "test run failed. {}", stderr);

    // Should NOT have provider ended message
    assert!(
        !stderr.contains("Test ended early because one or more providers ended"),
        "Should not have provider ended message. Got: {}",
        stderr
    );

    // Should NOT have logger kill message
    assert!(
        !stderr.contains("Test killed early by logger"),
        "Should not have logger kill message. Got: {}",
        stderr
    );

    let left = stderr;
    let right = include_str!("integration.stderr.out");
    assert_eq!(left, right);
}

#[test]
fn int_on_demand() {
    let (result, _stdin, stderr) = run_test("tests/int_on_demand.yaml");

    assert!(result.is_ok(), "test run failed. {}", stderr);

    // Should NOT have provider ended message
    assert!(
        !stderr.contains("Test ended early because one or more providers ended"),
        "Should not have provider ended message. Got: {}",
        stderr
    );

    // Should NOT have logger kill message
    assert!(
        !stderr.contains("Test killed early by logger"),
        "Should not have logger kill message. Got: {}",
        stderr
    );

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

#[test]
fn test_exit_code_logger_kill() {
    let (result, _stdout, stderr) = run_test("tests/test_logger_ends.yaml");

    // Should be Ok with KilledByLogger reason
    match result {
        Ok(pewpew::TestEndReason::KilledByLogger) => {
            assert!(
                stderr.contains("Test killed early by logger"),
                "Expected logger kill message in stderr. Got: {}",
                stderr
            );
            // Should NOT have provider ended message
            assert!(
                !stderr.contains("Test ended early because one or more providers ended"),
                "Should not have provider ended message in stderr. Got: {}",
                stderr
            );
        }
        Ok(other) => panic!("Expected KilledByLogger, got {:?}", other),
        Err(e) => panic!("Test failed with error: {:?}", e),
    }
}

#[test]
fn test_exit_code_provider_ends_early() {
    let (result, _stdout, stderr) = run_test("tests/test_provider_ends_early.yaml");

    // Should be Ok with ProviderEnded reason
    match result {
        Ok(pewpew::TestEndReason::ProviderEnded) => {
            // MUST have the provider ended message
            assert!(
                stderr.contains("Test ended early because one or more providers ended"),
                "Expected provider ended message in stderr. Got: {}",
                stderr
            );
            // Should NOT have logger kill message
            assert!(
                !stderr.contains("Test killed early by logger"),
                "Should not have logger kill message. Got: {}",
                stderr
            );
        }
        Ok(other) => panic!("Expected ProviderEnded, got {:?}", other),
        Err(e) => panic!("Test failed with error: {:?}", e),
    }
}

#[test]
fn test_provider_ends() {
    let (result, _stdout, stderr) = run_test("tests/test_provider_ends.yaml");

    // This test has a 20s duration with a provider that ends at 3 items
    // At 1hps it should complete normally (provider exhausts near the end)
    match result {
        Ok(pewpew::TestEndReason::Completed) => {
            // Expected - provider exhausted but test reached expected duration
            // Should NOT have provider ended message
            assert!(
                !stderr.contains("Test ended early because one or more providers ended"),
                "Should not have provider ended message for Completed. Got: {}",
                stderr
            );
        }
        Ok(pewpew::TestEndReason::ProviderEnded) => {
            // Also acceptable if timing causes early completion
            // MUST have the provider ended message
            assert!(
                stderr.contains("Test ended early because one or more providers ended"),
                "Expected provider ended message in stderr for ProviderEnded. Got: {}",
                stderr
            );
        }
        Ok(other) => panic!("Expected Completed or ProviderEnded, got {:?}", other),
        Err(e) => panic!("Test failed with error: {:?}", e),
    }

    // Should NOT have logger kill message
    assert!(
        !stderr.contains("Test killed early by logger"),
        "Should not have logger kill message. Got: {}",
        stderr
    );
}

#[test]
fn test_provider_optional() {
    let (result, _stdout, stderr) = run_test("tests/test_provider_optional.yaml");

    // This test uses a response provider that gets filled by another endpoint
    // Should complete normally
    match result {
        Ok(pewpew::TestEndReason::Completed) => {
            // Expected - normal completion
            // Should NOT have provider ended message
            assert!(
                !stderr.contains("Test ended early because one or more providers ended"),
                "Should not have provider ended message for Completed. Got: {}",
                stderr
            );
        }
        Ok(pewpew::TestEndReason::ProviderEnded) => {
            // Also acceptable if provider exhausts early
            // MUST have the provider ended message
            assert!(
                stderr.contains("Test ended early because one or more providers ended"),
                "Expected provider ended message in stderr for ProviderEnded. Got: {}",
                stderr
            );
        }
        Ok(other) => panic!("Expected Completed or ProviderEnded, got {:?}", other),
        Err(e) => panic!("Test failed with error: {:?}", e),
    }

    // Should NOT have logger kill message
    assert!(
        !stderr.contains("Test killed early by logger"),
        "Should not have logger kill message. Got: {}",
        stderr
    );
}
