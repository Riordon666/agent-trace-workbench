# Trace Diff and Regression Semantics

`atw diff` verifies and compares two portable `.atwtrace` archives without importing a Session, starting the workbench, executing a command, or calling a model.

```bash
atw diff baseline.atwtrace candidate.atwtrace
atw diff baseline.atwtrace candidate.atwtrace --json
atw diff baseline.atwtrace candidate.atwtrace --fail-on-regression
atw diff baseline.atwtrace candidate.atwtrace --thresholds trace-thresholds.json
```

Both archives pass the same path, size, manifest, schema, privacy-report, and checksum validation used by `atw open`. A modified or unchecked archive is rejected before comparison.

## Status

- `equivalent`: no structural or metric difference was observed under the normalized comparison model.
- `changed`: a difference was observed, but no configured regression rule fired.
- `regression`: one or more evidence-based regression rules fired.

Token changes, tool-call count changes, Agent/model changes, and event-type changes are always reported. They are not regressions by themselves because an increase can be expected or beneficial.

Default regression rules are:

| Code | Rule |
|---|---|
| `errors_increased` | Observed normalized error events increase by more than 0. |
| `failed_commands_increased` | Explicitly failed command tool results increase by more than 0. |
| `retry_signals_increased` | Observed retry markers or repeated failed calls increase by more than 0. |
| `incomplete_requests_increased` | Requests with a start but no successful observed end increase by more than 0. |
| `reasoning_became_unavailable` | A contains visible reasoning evidence and B does not. |
| `duration_increased` | Duration increases by more than both 1,000 ms and 20%, with a non-zero A baseline. |

The comparison uses one normalized source per metric category to avoid double counting a trace containing both protocol capture and Agent History.

## Custom thresholds

Pass a JSON object with any subset of these non-negative values:

```json
{
  "duration_percent": 30,
  "duration_absolute_ms": 2500,
  "errors_increase": 0,
  "failed_commands_increase": 0,
  "retry_signals_increase": 1,
  "incomplete_requests_increase": 0
}
```

Unknown fields and negative/non-numeric values are rejected so a misspelled policy cannot silently disable a check.

## CI behavior

Without `--fail-on-regression`, a successfully verified comparison exits with code 0 for all three statuses. With the flag, `regression` exits with code 2. Invalid arguments, unreadable files, invalid threshold JSON, or failed archive verification exit with code 1.

JSON output includes metric rows, per-event-type changes, per-tool calls/failures, Agent/Provider/model additions and removals, request completeness, configured thresholds, and the regression evidence list.

The same default engine appears in **Session Explorer → Session Comparison**. UI comparisons operate on local normalized Session events; CLI comparisons operate on verified portable archives.

