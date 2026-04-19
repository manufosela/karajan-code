# Brain decisor

Karajan's Brain is now the pipeline's decisor: it reads the triage output
plus the task text, classifies intent, and decides which roles should run
for the current task. The existing flag-based stage execution continues to
drive runFlow — Brain just tells it which flags should be on.

## What changes vs. the legacy pipeline

Before:

```
triage → applyTriageOverrides → runPlanningPhases → runLoop(flags)
```

Flags came from config + CLI. Triage only adjusted a few roles.

After:

```
triage → applyTriageOverrides → BRAIN DECISOR → runPlanningPhases → runLoop(flags)
                                      │
                                      └─ consults Solomon on low-confidence
```

The Brain translates `{level, taskType, roles, domainHints, confidence}`
from triage into a structured `Decision` with `rolesOn` / `rolesOff` and
applies it onto `pipelineFlags`.

## Decision anatomy

```js
{
  rolesOn: ["coder", "reviewer", "tester"],   // enabled
  rolesOff: ["architect", "security", ...],   // explicitly disabled
  confidence: "low" | "medium" | "high",
  rationale: "level=medium | taskType=sw | roles=[...] | overrides=[skip:tester]",
  consultSolomon: false,                      // true when ambiguous
  solomonReason: "triage confidence 0.40 < 0.6",
  appliedOverrides: ["skip:tester", "solomon-add:security"]
}
```

## Routing rules

The baseline role set is derived from the triage level:

| Level | Baseline |
|---|---|
| trivial | `coder` |
| simple | `coder`, `reviewer` |
| medium | `coder`, `reviewer`, `tester` |
| complex | `researcher`, `architect`, `planner`, `coder`, `reviewer`, `tester`, `security` |

On top of that, `taskType` adjustments apply:

| taskType | Adjustments |
|---|---|
| `sw` | baseline only |
| `doc` | drop `tester`, `security`, `refactorer` |
| `add-tests` | `+tester`, drop `security` |
| `refactor` | `+refactorer`, `+tester` |
| `infra` | `+architect`, `+security` |
| `audit` | drop `coder`; `+reviewer`, `+security` |
| `no-code` | drop `coder`, `reviewer`, `tester` |

Then:

- Triage's own suggested roles are merged in.
- `config.pipeline.{role}.enabled = false` forces a role off.
- CLI overrides (`--skip-role X`, `--force-role X`) win above everything.
- `coder` is always included unless the task is `audit` / `no-code` or the user
  explicitly skipped it.

## Solomon consultation

The Brain consults Solomon whenever the decision has low confidence — today
that means:

- Triage returned no `level` (malformed output, provider error).
- Triage reported `confidence < 0.6`.
- (Future) Two active roles disagree on whether to continue.

Consultation is **advisory**: Solomon's `suggestedActions` are parsed for
`add X` / `skip X` / `enable X` / `disable X` patterns and applied. If
Solomon is disabled, fails, or returns nothing actionable, the baseline
decision stands (logged in the rationale).

## Configuration & flags

### Config

```yaml
brain:
  decisor:
    enabled: true          # default in production; tests default to false
    maxDecisions: 20       # per-session safety limit
```

`globalThis.__KJ_DEFAULT_BRAIN_DECISOR` is set to `false` in `tests/setup.js`
so orchestrator tests that assert exact flag state are not affected by the
router. Tests that exercise Brain routing opt in explicitly via the config
field.

### CLI

```bash
kj run "task" --brain=on                # force Brain on (default)
kj run "task" --brain=off                # legacy routing only (no Brain)
kj run "task" --skip-role tester security
kj run "task" --force-role security
```

These flags also work via the `kj_run` MCP tool:

```json
{
  "task": "review the auth changes",
  "brain": "on",
  "skipRole": ["tester"],
  "forceRole": ["security"]
}
```

## Safety limits

- **Max decisions per session**: 20 by default. Once reached, Brain skips
  further routing and the pipeline continues on the last known flag state.
  Surfaced as event `brain:decision` with `status: "warn"`.
- **Indecision loop**: if the Brain classifies the same intent (e.g.
  `sw:medium`) three times in a row, it logs a warning and stops asking
  Solomon. Protects against runaway token spend when triage is noisy.

## Events

- `brain:decision` — emitted after every Brain decision with the resulting
  role set, confidence, rationale, and appliedOverrides in `detail`. Used by
  the session report and the HU Board for visualization.
- `solomon:start` / `solomon:end` — emitted by the existing Solomon flow
  when the Brain consults (same events used for mid-pipeline arbitration).

## Observability

Every decision is appended to `session.brainDecisions`. The summary is
available via `summarize(tracker)` from `src/brain/decision-tracker.js`:

```js
{
  total: 4,
  byIntent: { "sw:medium": 2, "refactor:simple": 1, "doc:trivial": 1 },
  lastRationale: "level=doc | taskType=doc | roles=[coder,reviewer] | ..."
}
```

Available in the final session report when you run `kj report --trace`.

## Out of scope for this iteration

- Parallel stage execution via DAG: current stages are not reentrant and
  share session state. A future refactor can restructure them as DAG nodes
  that run in parallel when independent. See `KJC-TSK-0315` for the
  orchestrator modularization that unlocks this.
- Cross-session learning: today the Brain is stateless between sessions.
  Learning which decisions led to good vs. bad outcomes and using that
  history for future routing lives in `KJC-PCS-0022` (Pipeline Sovereignty).
- Brain as binding Solomon arbiter for routing: currently Solomon's ruling
  is advisory in routing context; it remains binding in the runtime dilemma
  paths (stalled loops, max iterations, rate limits).
