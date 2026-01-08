use std::collections::BTreeMap;

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

        // Build env vars map with PORT set
        let mut env_vars = BTreeMap::new();
        env_vars.insert("PORT".to_string(), port.to_string());

        let (_, ctrlc_channel) = futures::channel::mpsc::unbounded();

        // Use a unique stats file name based on the test file to avoid parallel test interference
        let stats_file = format!("stats-{}.json", path.replace('/', "_").replace(".yaml", ""));

        let run_config = pewpew::RunConfig {
            config_file: path.into(),
            output_format: pewpew::RunOutputFormat::Human,
            results_dir: Some("./".into()),
            stats_file: stats_file.into(),
            stats_file_format: pewpew::StatsFileFormat::Json,
            start_at: None,
            watch_config_file: true,
        };
        let exec_config = pewpew::ExecConfig::Run(run_config);

        let stdout = TestWriter::new();
        let stderr = TestWriter::new();

        let stdout2 = stdout.clone();
        let stderr2 = stderr.clone();

        let result =
            pewpew::create_run_with_env(exec_config, ctrlc_channel, stdout, stderr, env_vars).await;

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

// Helper function for try mode tests
fn run_try_test(
    path: &str,
) -> (
    Result<pewpew::TestEndReason, pewpew::TestError>,
    String,
    String,
) {
    let rt = Runtime::new().unwrap();
    rt.block_on(async move {
        let (port, kill_server, _) = start_test_server(None).await;

        // Build env vars map with PORT set
        let mut env_vars = BTreeMap::new();
        env_vars.insert("PORT".to_string(), port.to_string());

        let (_, ctrlc_channel) = futures::channel::mpsc::unbounded();

        let try_config = pewpew::TryConfig {
            config_file: path.into(),
            file: None,
            filters: None,
            format: pewpew::TryRunFormat::Json,
            loggers_on: false,
            results_dir: None,
            skip_response_body_on: false,
            skip_request_body_on: false,
        };
        let exec_config = pewpew::ExecConfig::Try(try_config);

        let stdout = TestWriter::new();
        let stderr = TestWriter::new();

        let stdout2 = stdout.clone();
        let stderr2 = stderr.clone();

        let result =
            pewpew::create_run_with_env(exec_config, ctrlc_channel, stdout, stderr, env_vars).await;

        let _ = kill_server.send(());

        (result, stdout2.get_string(), stderr2.get_string())
    })
}

/// Test that try mode works with declare/collect that needs multiple provider values
/// This tests the fix for the hang where collect would wait forever for provider values
#[test]
fn try_mode_collect_multiple_values() {
    let (result, stdout, stderr) = run_try_test("examples/provider_collect.yaml");

    assert!(result.is_ok(), "try mode test failed. stderr: {}", stderr);

    // Should have completed successfully
    match result {
        Ok(pewpew::TestEndReason::Completed) => {
            // Verify we got multiple calls (endpoint 0 runs 20 times, endpoint 1 once, endpoint 2 once)
            // The stdout contains JSON output for each call
            let call_count = stdout
                .lines()
                .filter(|line| line.contains("\"request\""))
                .count();
            assert!(
                call_count >= 20,
                "Expected at least 20 calls in try mode, got {}. stdout: {}",
                call_count,
                stdout
            );
        }
        Ok(other) => panic!("Expected Completed, got {:?}", other),
        Err(e) => panic!("Test failed with error: {:?}. stderr: {}", e, stderr),
    }
}

/// Test that try mode works with simple declare (not collect)
#[test]
fn try_mode_declare_simple() {
    let (result, stdout, stderr) = run_try_test("examples/declare.yaml");

    assert!(result.is_ok(), "try mode test failed. stderr: {}", stderr);

    match result {
        Ok(pewpew::TestEndReason::Completed) => {
            // Should have at least one successful call
            let call_count = stdout
                .lines()
                .filter(|line| line.contains("\"request\""))
                .count();
            assert!(
                call_count >= 1,
                "Expected at least 1 call, got {}. stdout: {}",
                call_count,
                stdout
            );
        }
        Ok(other) => panic!("Expected Completed, got {:?}", other),
        Err(e) => panic!("Test failed with error: {:?}. stderr: {}", e, stderr),
    }
}

/// Test that try mode works with delete_search.yaml which uses collect with take: [0, 20]
#[test]
fn try_mode_delete_search_collect() {
    let (result, stdout, stderr) = run_try_test("examples/delete_search.yaml");

    assert!(result.is_ok(), "try mode test failed. stderr: {}", stderr);

    match result {
        Ok(pewpew::TestEndReason::Completed) => {
            // Should have at least 2 successful calls (one POST to create, one DELETE to delete)
            let call_count = stdout
                .lines()
                .filter(|line| line.contains("\"request\""))
                .count();
            assert!(
                call_count >= 2,
                "Expected at least 2 calls, got {}. stdout: {}",
                call_count,
                stdout
            );

            // Verify we got both 200 and 204 status codes
            assert!(
                stdout.contains("\"200\"") || stdout.contains("200"),
                "Expected 200 status code in output. stdout: {}",
                stdout
            );
            assert!(
                stdout.contains("\"204\"") || stdout.contains("204"),
                "Expected 204 status code in output. stdout: {}",
                stdout
            );
        }
        Ok(other) => panic!("Expected Completed, got {:?}", other),
        Err(e) => panic!("Test failed with error: {:?}. stderr: {}", e, stderr),
    }
}
