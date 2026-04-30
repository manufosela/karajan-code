# SKILL: kj run

## What it does

Executes the **full Karajan pipeline** against a task: triage →
researcher → architect → coder → reviewer → tester → SonarQube quality
gate. Either against a one-shot task description or against a
pre-generated plan (multiple HUs).

## Inputs

| Input | Form | Required |
|---|---|---|
| Task description | positional `[task]` | one of (positional, `--task-file`, `--plan`) |
| Task from file | `--task-file <path>` | one of |
| Pre-generated plan | `--plan <planId>` | one of (reuses `plan.task`) |
| Filter to specific HU(s) | `--hu <hu1>,<hu2>,...` | optional, requires `--plan` |
| Skip cwd prompt | `-y` / `--yes` | optional |
| Override coder | `--coder <provider>` | optional |
| Override reviewer | `--reviewer <provider>` | optional |
| Provider model | `--coder-model <name>` / `--reviewer-model <name>` | optional |
| Force role on/off | `--enable-<role>` / `--skip-role <name>` | optional |
| Methodology | `--methodology tdd|standard` | optional |
| Max iterations | `--max-iterations <n>` | optional |
| Task type | `--task-type sw|infra|doc|add-tests|refactor` | optional |
| PG card link | `--pg-task <KJC-TSK-NNNN> --pg-project <name>` | optional |

## Outputs

- **stdout**: streaming pipeline log (triage → coder → reviewer → ...).
- **disk**:
  - new commits in the working git repo (per HU, atomic).
  - session under `~/.karajan/sessions/<sid>/` (status + activity log + checkpoints).
  - HU batch under `~/.karajan/hu-stories/<batchSessionId>/` (plan-driven runs).
  - run log mirror at `~/.karajan/hu-board-runs/<planId>[-<huId>].log` when launched from the board.
- **exit 0**: every HU approved (or single-task pipeline approved).
- **exit non-zero**: max_iterations reached unresolved, infrastructure error, or one HU failed (others blocked transitively).

## Constraints

- Must run inside a git repo. Coder writes commits there.
- Coder subprocess (`claude` / `codex` / etc.) must be installed and authenticated.
- SonarQube container must be reachable for `sw` task types (kj auto-starts it via Docker).
- Node ≥ 22 for the orchestrator (subprocess agents have their own minimums).

## Side effects

- **Many**. The coder writes files to the project, runs `pnpm install`, makes commits, may push to remote (if `git.auto_push: true`), may open PRs (if `git.auto_pr: true`).
- The HU sub-pipeline updates HU statuses live in the plan JSON: `certified` → `coding` → `reviewing` → `done|failed|blocked`.
- The HU Board (port 4000) is auto-started if not running, unless `hu_board.enabled: false`.
- Each HU may make multiple agent calls: budget tracker accumulates real $ cost, surfaced in stdout.

## Common failure modes

| Error | Cause | Fix |
|---|---|---|
| `Coder failed: 403 ... Account is no longer in organisation` | Coder LLM auth expired | Re-login the coder (e.g. `claude login`) |
| `Cannot read properties of undefined (reading 'issuesInitial')` | Caller forgot `sonarState` (pre-PR #545 bug — guarded) | Fixed; if you see it, file a bug |
| `Coder escribió fuera del projectDir` | Coder ran `cd ~/foo && ...` (real leak) — OR a concurrent host write polluted $HOME (false positive, fixed in #547) | Inspect the listed paths; move/delete; edit the HU title to remove absolute paths |
| `max iterations reached with acceptance tests still failing` | Test contract too strict, or really broken implementation | Inspect the failing test; if test is broken, the Repairer should have caught it (post-#545) — verify the failure signature matches an `infeasible` kind |
| `All HUs completed successfully` for zero work | Stale on-disk batch overrode plan (pre-PR #544) | Fixed; if you see it, delete `~/.karajan/hu-stories/<batchSessionId>/` and relaunch |

## Example

```bash
# Run a one-shot task (auto-decomposed)
kj run --task-file SPEC.md -y

# Run against a generated plan
kj plan generate --task-file SPEC.md -y       # produces plan-...
kj run --plan plan-20260429094214-0srv -y     # consumes it

# Run only one HU of the plan
kj run --plan plan-... --hu hu_plan-..._004 -y

# Override providers for a single run
kj run --plan plan-... --coder codex --reviewer claude -y

# Resume after a crash
kj resume <sessionId>
```

## Related

- [SKILL.kj-plan.md](SKILL.kj-plan.md) — generate the input.
- [SKILL.kj-audit.md](SKILL.kj-audit.md) — analyse without running the pipeline.
- `kj resume <sid>` — pick up after a crash. Run state lives under `~/.karajan/sessions/<sid>/`.
