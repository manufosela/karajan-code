# Resilience tests — `tests/resilience/`

Index of the tests added by the **resilience audit (2026-05-22)**. Each
entry pins a specific failure mode that Karajan used to handle silently
or with an opaque crash. If you change anything in the affected file,
run the listed test first — these are the tripwires.

The audit's guiding rule: **the problem is not that something fails —
the problem is failing without telling the user why.**

## Phase 1 — Quota hibernation end to end

| Failure mode | Test |
|---|---|
| `"You've hit your session limit"` reaches `UNKNOWN_FATAL` instead of being recognised as a recoverable quota cap | `tests/brain/agent-error-classifier.test.js` (session limit block) · `tests/rate-limit-detector.test.js` (12-hour clock block) |
| `withBrainRecovery` does not persist a standby snapshot because no caller passes `sessionState` | `tests/brain/with-brain-recovery.test.js` (QUOTA + sessionState block) · `tests/brain/standby-store.test.js` (`buildStandbyState`) |
| The orchestrator treats `action:"hibernate"` as a generic failure (HU sealed `failed` instead of `hibernated`) | `tests/orchestrator/coder-and-refactorer-hibernate.test.js` · `tests/session/session-status-sealing.test.js` (hibernated case) |
| A stopped run never tells the user how to resume it | `tests/utils/resume-hint.test.js` · `hibernate-end-to-end.test.js` (in this folder) |

## Phase 2 — Don't lie

| Failure mode | Test |
|---|---|
| `runCommand` swallows an ENOENT (missing agent CLI) and returns an empty error | `tests/process-spawn-failure.test.js` |
| `AgentRole.execute()` never forwards `silenceTimeoutMs`, so a hung coder hangs `kj run` forever | `tests/coder/coder-role.test.js` (silenceTimeoutMs block) |
| State writes are not atomic — interrupted writes leave truncated JSON | `tests/utils/atomic-write.test.js` |

## Phase 3 — Don't lose or block

| Failure mode | Test |
|---|---|
| A corrupt plan JSON vanishes silently from `kj plan list` / `kj plan load` | `tests/plan/plan-store-corrupt.test.js` |
| `kj.config.yml` parse error bricks every kj command (including `kj doctor`) with no path in the message | `tests/config-yaml-error.test.js` |
| A killed `kj run --plan` leaves HUs stuck in `coding` forever — the board-side reaper never sees a headless run | `tests/orchestrator/plan-hu-zombie-reconciler.test.js` |
| Board SQLite has no busy-timeout / no schema version / no corruption recovery | `packages/hu-board/tests/db-hardening.test.js` |

## Phase 4 — Don't degrade silently

| Failure mode | Test |
|---|---|
| `TriageRole` returns `ok:true` with safe defaults on an unparseable LLM output (skips roles silently) | `tests/triage/triage-role.test.js` (degraded triage block) |
| `verifyCoderOutput` confuses a git failure (bad baseRef, repo corrupt, git missing) with "the coder did nothing" — burns iterations blaming the agent | `tests/verification-gate.test.js` (gitError block) |

## Phase 5 — Integration tripwires

| Scenario | Test |
|---|---|
| Quota exhaustion end-to-end: classified → standby persisted → action surfaced → resume hint printed | `tests/resilience/hibernate-end-to-end.test.js` |
