# Spec Reviewer

The **spec-reviewer** runs BEFORE every other role in the Karajan pipeline. It audits whatever the user passed to `kj run` or `kj plan` — a prompt string, the contents of `--task-file foo.md`, a piped spec — and surfaces deficiencies that would otherwise cause the pipeline to spend tokens on the wrong work.

> *The problem is not that something fails, the problem is failing without telling the user why* — same family of guardrails as the v2.18.0 resilience audit, applied this time to the **input** before any agent has run.

## What it checks

Seven categories. Every finding gets exactly one.

| Category | Trigger |
|---|---|
| `ambiguity` | Words without a concrete metric ("better", "clean", "fast"). |
| `missing_scope` | No boundary of what should and should not be touched. |
| `missing_ac` | No acceptance criteria — nothing to verify against. |
| `contradiction` | Two requirements that cannot both be satisfied. |
| `stack` | No tech stack hint when one is required. |
| `assumptions` | Depends on unstated context. |
| `out_of_scope` | Asks for things outside what Karajan can do. |

## Severity

`info` (nuance) → `warn` (real gap) → `fail` (unworkable).
Top-level severity is the **worst** of any finding (`ok` if none).

Karajan trusts the **worse** of declared-by-agent vs derived-from-findings: an agent that says `severity: "ok"` while still listing a `fail`-level finding doesn't get to override the data.

## How the user experiences it

**Clean spec** — one cyan line, that's it:

```
[info] ✓ spec OK
```

**Findings present** — pretty-printed on stderr, grouped by category, severity-coloured, suggestion below each as the actionable fix-it:

```
Spec review — FAIL (3 findings)
── ambiguity
  ● F-001 The spec says 'haz algo bonito' — 'algo' and 'bonito' have no concrete meaning.
    → Replace with the specific artifact + the metric that makes it 'bonito' …
── missing_scope
  ● F-002 No mention of which files, modules or layers should be touched.
    → Specify the target directory or file …
── missing_ac
  ● F-003 No acceptance criteria — nothing to verify against.
    → Add 'Acceptance: …' with at least one measurable test.

Spec review: 3 findings at severity fail. [c]ontinue / [r]efine / [x]cancel? (default: continue)
```

**Pick `r`** and the role rewrites your spec:

1. The agent returns a v2 of the spec that addresses every finding.
2. Karajan persists both versions:
   - `<projectDir>/.reviews/spec-review-<ISO>/spec-v1.md` (the original).
   - `<projectDir>/.reviews/spec-review-<ISO>/spec-v2.md` (the rewritten).
   - If you used `--task-file foo.md`, a copy lands at `foo.v2.md` next to the original.
3. `$EDITOR` opens on `spec-v2.md` (`$VISUAL` → `$EDITOR` → `vi` precedence).
4. When you save and quit:
   - **No edits** → Karajan proceeds with the rewritten v2 as the effective spec for the rest of the pipeline.
   - **You modified v2** → Karajan re-runs the reviewer on your version. New findings may appear → prompt again.
5. The loop caps at **5 iterations**.

## Bypass

Per-invocation:

- CLI: `kj run --skip-spec-review "<task>"` or `kj plan generate --skip-spec-review`.
- MCP: pass `specReviewMode: "skip"` to `kj_run` or `kj_plan`.

Globally, in `~/.karajan/kj.config.yml` (or per-project `<projectDir>/.karajan/kj.config.yml`):

```yaml
spec_reviewer:
  enabled: false
```

## Configuration

```yaml
roles:
  spec_reviewer:
    provider: claude          # claude | codex | gemini | aider | opencode
    model: claude-haiku       # optional; if omitted, inherits from coder
```

If neither `provider` nor `model` is set, the reviewer inherits from the `coder` role — same pattern as `triage`, `hu-reviewer`, `researcher`, etc.

## Project-level prompt override

Drop a `<projectDir>/.karajan/roles/spec-reviewer.md` to extend (or replace) the bundled template at `templates/roles/spec-reviewer.md`. Your content is prepended to the agent prompt as `instructions`, so it can add project-specific rules without losing the base contract.

## When NOT to use it

- One-line micro-tasks where the spec IS the criterion ("fix the typo on README line 4"). Bypass with `--skip-spec-review`.
- Re-runs of a previously approved spec (Karajan doesn't yet cache approvals; this is on the roadmap).
- Inside scripts where stderr is parsed for something else — pass `--skip-spec-review` to keep the output clean.

## How it's wired

- **Role**: `src/roles/spec-reviewer-role.js` (extends `AgentRole`).
- **Prompt builders**: `src/prompts/spec-reviewer.js` — `buildSpecReviewerPrompt()` (review) + `buildSpecRefinerPrompt()` (refine).
- **Template**: `templates/roles/spec-reviewer.md` (the bundled default override target).
- **CLI orchestrator**: `src/spec-review/run-spec-review.js` — bounded outer loop with `[c]/[r]/[x]` branches.
- **Refine helper**: `src/spec-review/refine-loop.js` — single `refineSpec → persist v1/v2 → $EDITOR → hash-diff` iteration.
- **Findings printer**: `src/utils/display/spec-findings.js` — colour-coded, category-grouped stderr output.
- **Wiring**: `src/commands/run.js` + `src/commands/plan/generate.js` (CLI) and `src/mcp/handlers/run-handler.js` + `src/mcp/handlers/direct-handlers.js` (MCP).

## Roadmap

- **Cache by spec-hash**: skip the role when an identical spec has already passed in a recent session.
- **MCP `ask` mode**: today `specReviewMode` is `auto` (run + never block) or `skip`; an `ask` mode that streams findings to the client and waits for an explicit decision is a natural extension once the MCP client surface matures.
- **HU Board "Specs audited" panel** with the v1/v2 diff and the agent's reasoning.
