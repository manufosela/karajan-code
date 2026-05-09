# Golden tasks regression suite

**Status**: Active (introduced in v2.12.0 — KJC-TSK-0374)
**Implementation**: `src/golden/{schema,loader,asserter,runner}.js` · fixtures in `tests/golden/tasks/` · baseline in `tests/golden/baseline.json`

## What it answers

> *Did Karajan v2.X get worse than v2.X-1?*

The existing e2e suite checks exit codes — "did `kj run` finish without crashing?". The golden tasks suite goes one step further: it checks the *quality of the output* by running a small set of canonical tasks and comparing structural properties of the result against fixed expectations.

If a v2.X coder starts producing fewer commits, lower plan adherence, or skipping the test files it used to write, the golden suite catches it before the release lands on npm.

## How it works

For each task in `tests/golden/tasks/*.json`:

1. **Sandbox** — fresh dir under `/tmp` (or the path you pass in).
2. **Spawn** — `kj run "<prompt>" -y` with the task's `timeout_minutes`.
3. **Locate** — newest `summary.md` under `.karajan/sessions/*/`.
4. **Assert** — five families:
   - `expected_commits_min` (parsed from `## Commits`)
   - `expected_audit_status` (parsed from the `audit` row in `## Stages`)
   - `expected_plan_adherence_min` (parsed from the `## Plan adherence` section, see [`plan-adherence.md`](./plan-adherence.md))
   - `expected_test_files` (`fs.stat` against the workdir)
   - `allowed_loc_range` (`git diff --numstat baseSha..HEAD` summed)
5. **Verdict** — `{ ok, kjExit, summaryPath, parsed, failures: [{kind, expected, actual, message}] }`. Exit non-zero on any failure.

No LLM judge — every assertion is deterministic and re-derivable by hand from the workdir.

## The 3 canonical tasks

| ID | What it exercises |
| --- | --- |
| `todo-rest-api` | Express REST API + Vitest. Planner decomposition, sub-pipelines, multiple endpoints. The N4 happy-path demo. |
| `npm-package-cli` | Single-file CLI with commander + Vitest. Tests the planner's discipline on a focused feature. |
| `react-counter-component` | TypeScript + React + Testing Library. Verifies non-JS framework selection and TSX-aware audit. |

The set is intentionally small (option B from the original 10-task spec). Three tasks cover three orthogonal domains (backend, CLI, frontend). Anything more would inflate release time without improving signal.

## Schema

A golden task JSON has the shape (see `src/golden/schema.js`):

```jsonc
{
  "id": "lowercase-kebab",
  "title": "Human-readable title",
  "prompt": "What the user would type into kj run",
  "description": "(optional) why this task exists",
  "timeout_minutes": 30,                 // optional, default 30
  "expected_commits_min": 3,
  "expected_audit_status": "pass",       // pass | warning | fail
  "expected_test_files": ["tests/x.test.js"],
  "allowed_loc_range": [80, 350],        // [min, max] of `git diff --numstat`
  "expected_plan_adherence_min": 70      // optional, 0-100
}
```

Validation rejects: empty prompts, ids with non-`[a-z0-9_-]` chars, audit statuses outside the picklist, LOC ranges where min > max, plan adherence outside 0-100.

## Baseline (`baseline.json`)

The asserter checks each task against the JSON spec. The **baseline** is a separate, looser tracking file — it records the most recent successful run (commits, plan adherence, LOC, audit status, kj version, timestamp). The regression check fails when the next run scores meaningfully worse than the baseline, even when both technically pass the spec.

The baseline ships with `null` values; the runner populates them on the first green release-candidate run.

## When the suite runs

- **Pre-release** — manually before tagging `vX.Y.Z`. Roughly $5-10 in API calls per full run.
- **CI** — gated behind a `golden-tasks` label or a manual workflow dispatch. Not a per-PR check (too expensive, too slow).

The runner is library-only in this release; CLI integration (`kj benchmark golden`) is queued for a follow-up task.

## Output volume

A full run of all 3 tasks takes 30-60 minutes wall clock and ~$5-10 of API spend with the default coder/reviewer pair. Each task writes its own `summary.md`, `iterations.md`, etc. under `.karajan/sessions/`; the runner reads only `summary.md` to keep the assertion logic simple and stable across schema changes elsewhere.

## Related

- **TSK-0376** ([`plan-adherence.md`](./plan-adherence.md)) — the per-run metric this suite asserts against.
- **TSK-0327** — process-skills catalog. A future enhancement would also assert "which addyosmani skills did the planner pull?" — left for a follow-up.
- `src/golden/schema.js` — Valibot schema (PR #648).
- `src/golden/asserter.js` — summary parser + assertion engine (PR #650).
- `src/golden/runner.js` — subprocess driver + filesystem assertions (PR #651).
