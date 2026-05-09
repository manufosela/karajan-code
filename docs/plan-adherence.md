# Plan adherence metric

**Status**: Active (introduced in v2.12.0 — KJC-TSK-0376)
**Implementation**: `src/audit/plan-adherence.js` · integration in `src/orchestrator/drivers/post-loop.js` · rendering in `src/session/journal/summary-writer.js`

## What it answers

> *Did the coder actually follow the plan, or did the run drift?*

Plan adherence is a deterministic, offline 0–100 score computed at the end of every `kj run` that executed against a known plan. It surfaces in `summary.md` next to the budget and stages so reviewers can spot drift at a glance instead of cross-referencing commits with the plan by hand.

The metric is inspired by the [deepeval](https://deepeval.com/guides/guides-ai-agent-evaluation) agent-evaluation guide but stays purely deterministic: no LLM calls, no API keys, no extra cost. The signal comes from the plan JSON, the actual commits produced during the run, and the files git reports as changed since `head_at_start`.

## Components

The score is a weighted average of four sub-scores. Each component is independent and may return `null` when there is no data to compute it; the aggregator redistributes the freed weight across the remaining components.

| Component | Weight | What it measures |
| --- | --- | --- |
| Commit attribution | 40% | What fraction of HUs in the plan got at least one commit message that mentions the HU id (e.g. `hu_001`)? |
| Acceptance tests | 30% | Of the HUs that declared `acceptance_tests`, how many of those tests survive into the final commit set (heuristic: test name appears in any commit message or any changed test file)? |
| Scope discipline | 20% | What fraction of changed files map to *any* HU's declared `scope` keywords? Files that match no HU count as drift. |
| Dependency order | 10% | When HUs declare `blocked_by` edges, were the commits attributed to them in topological order? |

## How attribution works

Commit attribution uses a tolerant regex matcher (`huIdMatcher` in `plan-adherence.js`) that finds the HU id as a whole token anywhere in a commit message. It is case-insensitive and tolerates surrounding punctuation, so any of the following match `hu_001`:

- `feat(hu_001): add login`
- `fix HU_001 — null pointer`
- `[hu_001] ...`

A single commit can attribute to multiple HUs (e.g. a refactor commit that touches three HUs and mentions all three ids). Commits that mention no HU id contribute to the **unattributed commits** list shown in the journal.

## Output shape

`computePlanAdherenceScore({ commits, plan, filesChanged })` returns:

```js
{
  score: 87,                           // 0-100 weighted aggregate, or null if all components are null
  breakdown: {
    commit_attribution: 100,           // 0-100, or null
    acceptance_tests: 67,
    scope_discipline: 80,
    dependency_order: null
  },
  hu_scores: [
    { huId: "hu_001", attributed: true,  issues: [] },
    { huId: "hu_002", attributed: false, issues: ["no commit attributed"] },
    ...
  ]
}
```

The journal section in `summary.md` renders `score`, the breakdown table, and the list of unattributed HUs (omitted when every HU got at least one commit).

## When it does NOT render

The Plan adherence section is **omitted entirely** when:

1. The session has no `_planRef.planId` (run was launched without a plan — `kj run "free-form task"`).
2. The plan exists but has zero HUs.
3. The plan has HUs but no commits and no files changed (calculation produces nulls everywhere).

This avoids cluttering one-off ad-hoc runs with a metric that wouldn't be meaningful.

## Why no LLM judge

We considered a deepeval-style LLM judge that would read the plan + commits + diff and return a qualitative score. Three reasons we kept it deterministic:

1. **Cost** — every `kj run` would pay for an extra Sonnet/Opus call. The deterministic version is free.
2. **Reproducibility** — same inputs always yield the same score, which makes the metric usable in regression suites (TSK-0374 golden tasks).
3. **Trust** — when the score is low, a reviewer can re-derive it by hand from the breakdown. An LLM verdict would be opaque.

A future TSK could add an *optional* LLM-judge layer on top (gated behind a flag), but the deterministic core stays the source of truth.

## Related

- **TSK-0374** — Golden tasks regression suite that uses this score to detect regressions in coder/reviewer quality.
- **TSK-0327** — Process catalog (`addyosmani/agent-skills`) — the Skills section in `summary.md` follows the same opt-in render pattern as Plan adherence.
- `tests/audit/plan-adherence.test.js` — 23 unit tests covering every component + the aggregator.
- `tests/session/summary-writer.test.js` — 4 tests covering the rendering path.
