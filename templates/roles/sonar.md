# Sonar Role (Non-AI)

This role wraps SonarQube static analysis. It is NOT an AI role but follows the same BaseRole lifecycle for pipeline uniformity.

## Behavior

1. Run `sonar-scanner` against the current codebase
2. Wait for analysis to complete
3. Retrieve quality gate status and open issues
4. Return structured results

## Configuration

- Requires SonarQube server (Docker or remote)
- Project key derived from repository name
- Enforcement profile configurable: `strict`, `normal`, `lenient`

## Quality gate interpretation

| Gate status | Action |
|-------------|--------|
| OK | Continue pipeline |
| ERROR | Block and send issues to Coder for fixing |
| WARN | Continue but include warnings in report |

## Output format

```json
{
  "ok": true,
  "result": {
    "gate_status": "ERROR",
    "project_key": "my-project",
    "issues": [
      {
        "severity": "CRITICAL",
        "type": "BUG",
        "file": "src/handler.js",
        "line": 42,
        "rule": "javascript:S1234",
        "message": "Null pointer dereference"
      }
    ],
    "total_issues": 3,
    "blocking": true
  },
  "summary": "Quality gate FAILED: 3 issues (1 critical bug, 2 code smells)"
}
```
