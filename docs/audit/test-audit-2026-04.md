# Test Suite Audit — 2026-04 (KJC-TSK-0307)

## Scope

- **Repository state**: `main` at commit 721dff2 (post TSK-0318).
- **Test files**: 230 in `tests/` plus 8 in `tests/agents/` / `tests/infrastructure/` / `tests/orchestrator/` / `tests/support/` / `tests/display/` / `tests/budget/`.
- **Total tests**: 3 629 (full suite).
- **Runtime**: ~45 s (warm cache), ~1 min cold — well inside tolerable.

## Findings

### 1. Tests covering unreachable / dead code

**None identified with confidence.** A grep for imports that resolve to non-existent source files found zero broken imports (`rg --files-without-match` against every `import from "../src/..."` resolved to an existing path). Spot-checking 20 random test files against current source modules showed every described module still in use by the pipeline.

**Recommendation**: no deletions in this PR. A deeper pass would need coverage instrumentation (`@vitest/coverage-v8`) run on full orchestrator scenarios to flag tests whose lines never execute against real flows, which is out of scope for this audit.

### 2. Near-duplicate tests from the AgentRole refactor

The 13 roles that now extend `AgentRole` (`coder`, `reviewer`, `planner`, `refactorer`, `solomon`, `researcher`, `tester`, `security`, `impeccable`, `triage`, `discover`, `architect`, `hu-reviewer`, `domain-curator`) each have at least one dedicated test file. Many share the same shape:

- "invokes the configured agent"
- "returns structured output on success"
- "propagates agent errors"
- "uses fallback model when first one is unsupported"

The `AgentRole` base itself is covered by `tests/roles/agent-role.test.js` (if present) / `tests/agents/agent-di.test.js` from the TSK-0316 work. The per-role files duplicate those assertions against a stubbed agent.

**Candidates for consolidation** (no changes in this PR — human validation first):

| Role test                              | Common with other role tests | Unique tests |
|----------------------------------------|------------------------------|--------------|
| `tests/coder-role.test.js`             | ~60% (agent invocation, error propagation) | coder-specific prompt assembly |
| `tests/reviewer-role.test.js`          | ~60%                         | JSON schema parsing |
| `tests/planner-role.test.js`           | ~70%                         | plan structure extraction |
| `tests/refactorer-role.test.js`        | ~80%                         | (mostly base behaviour) |
| `tests/solomon-role.test.js`           | ~70%                         | decision-tree serialization |
| `tests/researcher-role.test.js`        | ~80%                         | (mostly base behaviour) |
| `tests/tester-role.test.js`            | ~75%                         | test-framework detection |
| `tests/security-role.test.js`          | ~75%                         | (mostly base behaviour) |
| `tests/impeccable-role.test.js`        | ~70%                         | UI checklist enforcement |

**Proposed follow-up** (new card): create `tests/roles/_shared-role-tests.js` with a parametric `describeRoleBehaviour(RoleClass, { … })` helper, reduce each per-role file to 2-3 role-specific tests + a single `describeRoleBehaviour(MyRole, { defaultPrompt: …, expectedOutputShape: … })` call. Estimated saving: ~40% lines, same coverage.

### 3. Opt-in feature tests

**21 files** exercise subsystems that are disabled by default in production (brain, CI, sonar, hu-board, impeccable, webperf). Before this PR every run executed them because they mock the feature internally — no visible signal in test labels.

**This PR labels each top-level describe() block** with an `[opt-in: <feature>]` prefix so reports, `vitest --filter`, and future skip logic can locate them in one glob:

| Tag              | Files                                                                 |
|------------------|-----------------------------------------------------------------------|
| `opt-in: brain`  | `brain-coordinator`, `brain-wiring`                                   |
| `opt-in: ci`     | `ci-dispatch`, `ci-git-automation`, `ci-pr-diff`, `ci-repo`           |
| `opt-in: sonar`  | `sonar-api`, `sonar-config-resolver`, `sonar-enforcer`, `sonar-manager-init`, `sonar-manager`, `sonar-open`, `sonar-project-key`, `sonar-role`, `sonar-scanner-run`, `sonar-scanner`, `sonar-token-flow`, `sonarcloud-scanner` |
| `opt-in: hu-board` | `hu-board-sync`                                                     |
| `opt-in: webperf`| `webperf-detect`, `webperf-gate`                                      |

**Still pending labels** (to be addressed incrementally — not labeled here to keep the PR scope focused): tests under `tests/agents/` for individual providers are technically opt-in on CLI flag but already named explicitly by provider.

## New infrastructure

- **`tests/support/opt-in.js`** — `optIn(feature).describe(label, body)` helper plus `isOptInSkipped(feature)`. Describe blocks can migrate from the prefix-label approach to this helper if/when a test env wants to skip an opt-in at runtime via `KJ_SKIP_OPTIN_<FEATURE>=1` or `KJ_SKIP_ALL_OPTIN=1`.
- **`tests/support/opt-in.test.js`** — 7 tests for the helper itself.

Current PR uses **label-only prefixing** (safer: tests keep running under CI). The `optIn()` helper is wired in but not yet forced onto every labeled file — migrating each file from inline prefix → `optIn()` is a follow-up when we actually want to skip features in fast-feedback loops.

## Recommendations for follow-up

| Priority | Work | Est. |
|---|---|---|
| P1 | Migrate `optIn()` helper onto the 21 labeled files so `KJ_SKIP_ALL_OPTIN=1` works end-to-end | ~30 min |
| P2 | Parametric role-test helper (consolidation #2 above) | ~2 h, DP=3 |
| P2 | Coverage run + dead-code dig (consolidation #1 above) | ~2 h, needs instrumentation |
| P3 | Add `tests/support/fixtures/` for the repeated mock objects scattered across role tests | ~1 h |

## Verification

- `npx vitest run` → **3 629 / 282 files green** after labeling.
- `grep -l '\[opt-in:' tests/*.test.js` → 21 files tagged.
- `KJ_SKIP_ALL_OPTIN=1 npx vitest run tests/support/opt-in.test.js` smoke test passes (helper itself is a non-opt-in test so it runs either way).
