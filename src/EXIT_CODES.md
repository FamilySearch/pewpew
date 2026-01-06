# Exit Codes

Pewpew uses different exit codes to indicate how a test ended:

## Exit Code Reference

- **0** - Normal completion
  - `TestEndReason::Completed` - Test ran to completion successfully
  - `TestEndReason::ConfigUpdate` - Config was updated in watch mode (intermediate state, not final exit)

- **1** - Test error
  - Any `TestError` returned from the test execution (config errors, network errors, etc.)

- **2** - Provider ended early
  - `TestEndReason::ProviderEnded` - A used provider exhausted before the test reached 90% of its expected duration

- **3** - Logger killed the test
  - `TestEndReason::KilledByLogger` - A logger with `kill: true` and a `limit` reached its limit and terminated the test

- **130** - User interrupted with Ctrl-C
  - `TestEndReason::CtrlC` - User sent SIGINT (Ctrl-C) to interrupt the test

## Implementation Details

### Provider Exhaustion Behavior

When a provider's source stream exhausts (e.g., a file provider reads all lines, or a range provider reaches its end):

1. The provider signals via broadcast channel that it has exhausted
2. The system tracks which providers are actually used by endpoints
3. When endpoints complete, the system checks:
   - Did any **used** provider exhaust?
   - Did the test complete before 90% of the expected duration (or within 1 second for short tests)?
4. If both conditions are true → `ProviderEnded` (exit 0 with warning message)
5. Otherwise → `Completed` (exit 0, normal completion)

The threshold (90% of duration OR within 1 second) prevents false positives where a provider exhausts at 99% completion.

### Logger Kill Behavior

A logger can kill a test when:
- The logger has `kill: true` in its configuration
- The logger has a `limit` (or `kill: true` implicitly sets limit to 1)
- The limit number of log entries have been written

Example YAML:
```yaml
loggers:
  error_logger:
    to: stderr
    kill: true  # Kills test after first log
    limit: 1
```

## Agent Handling

The PPaaS agent (`agent/src/pewpewtest.ts`) handles exit codes as follows:

- **Exit 0**: Resolves the test promise, logs success at DEBUG level
- **Exit 2** (Provider ended early): Adds error to `ppaasTestStatus.errors`, logs at WARN level, but **resolves** (not a fatal error)
- **Exit 3** (Logger kill): Adds error to `ppaasTestStatus.errors`, logs at WARN level, but **resolves** (not a fatal error)
- **Exit 130** (Ctrl-C): Adds error to `ppaasTestStatus.errors`, logs at WARN level, resolves (user-initiated)
- **Exit 1 or other**: Adds error to `ppaasTestStatus.errors`, logs at ERROR level, **rejects** the promise

This allows the agent to distinguish between fatal errors (which should fail the test) and non-fatal terminations (like provider exhaustion, logger kills, or user interruptions) which completed their intended purpose but ended early.

## Testing

Integration tests verify each exit code scenario:
- `tests/test_logger_ends.yaml` - Tests logger kill (exit 3)
- `tests/test_long_run.yaml` - Can be interrupted with Ctrl-C (exit 130)
- `tests/integration.yaml` - Tests normal completion (exit 0)

Run integration tests:
```bash
TZ=UTC cargo test --test integration
```

Verify exit codes manually:
```bash
# Normal completion (exit 0)
RUST_LOG=warn PORT=8085 ../target/debug/pewpew run integration.yaml
echo $?  # Should print 0

# Logger kill (exit 3)
RUST_LOG=warn PORT=8085 ../target/debug/pewpew run test_logger_ends.yaml
echo $?  # Should print 3

# Ctrl-C (exit 130)
RUST_LOG=off PORT=8085 ../target/debug/pewpew run test_long_run.yaml
# Press Ctrl-C after a few seconds
echo $?  # Should print 130
```
