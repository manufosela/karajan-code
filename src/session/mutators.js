/**
 * Session mutators — the single site where the orchestrator mutates a
 * session object in memory.
 *
 * Rationale (TSK-0337, KJC-PCS-0040 Oleada 3): pre-v2.7.5 there were ~68
 * direct `session.x = value` assignments scattered across 18 files, with
 * one file (flow-runner.js) alone accounting for 142 touches. The audit
 * called this out as a HIGH finding: when a reviewer-retry bug landed in
 * production, a maintainer had to grep the whole tree to find every site
 * that writes to `session.last_reviewer_feedback` or
 * `session.reviewer_retry_count`.
 *
 * The mutators below are intentionally **mechanical** — each wraps a
 * single assignment — so the migration from `session.x = y` to
 * `setX(session, y)` is pure plumbing and preserves exact existing
 * semantics. The value is NOT validation or side-effects; it's that
 * grepping `setReviewerFeedback(` finds every writer in seconds. Adding
 * validation, event emission or persistence hooks later becomes a
 * one-liner inside the mutator rather than a tree-wide edit.
 *
 * Complementary architecture test:
 *   tests/architecture/session-write-boundary.test.js
 * enforces a budget on the remaining direct `session.x = y` assignments
 * outside `src/session/`. The budget only decreases; any new direct
 * assignment requires either going through a mutator or explicit audit.
 *
 * Naming convention:
 *   - setX          — overwrite field X with a new value.
 *   - incrementX    — numeric +1 (returns the new value).
 *   - resetX        — numeric 0 or null.
 *   - clearX        — delete the field entirely (when `in` matters).
 *   - appendToX     — push onto an array field.
 *   - assignX       — shallow-merge object into an object field.
 *
 * No mutator persists the session — callers are still responsible for
 * `await saveSession(session)` afterwards. This keeps the mutator
 * functions synchronous and cheap.
 */

// --- Retry counters -------------------------------------------------------

export const RETRY_KINDS = Object.freeze([
  "reviewer",
  "sonar",
  "tester",
  "security",
  "standby",
  "repeated_issue",
  "auto_resume",
  "checkpoint_stall",
]);

const RETRY_FIELD = {
  reviewer: "reviewer_retry_count",
  sonar: "sonar_retry_count",
  tester: "tester_retry_count",
  security: "security_retry_count",
  standby: "standby_retry_count",
  repeated_issue: "repeated_issue_count",
  auto_resume: "auto_resume_count",
  checkpoint_stall: "_checkpoint_stall_count",
};

export function setRetryCount(session, kind, value) {
  const field = RETRY_FIELD[kind];
  if (!field) throw new Error(`setRetryCount: unknown retry kind "${kind}"`);
  session[field] = Number(value) || 0;
  return session[field];
}

export function incrementRetryCount(session, kind) {
  const field = RETRY_FIELD[kind];
  if (!field) throw new Error(`incrementRetryCount: unknown retry kind "${kind}"`);
  session[field] = (session[field] || 0) + 1;
  return session[field];
}

export function resetRetryCount(session, kind) {
  return setRetryCount(session, kind, 0);
}

/**
 * Reset all well-known retry/repeat counters to 0. Called at the top of
 * every resume path so a resumed session doesn't inherit the previous
 * run's stall state.
 */
export function resetAllRetryCounters(session) {
  for (const kind of RETRY_KINDS) {
    // Skip checkpoint_stall: it's internal state owned by flow-control,
    // not something resume should touch.
    if (kind === "checkpoint_stall") continue;
    setRetryCount(session, kind, 0);
  }
}

// --- Feedback -------------------------------------------------------------

export function setReviewerFeedback(session, text) {
  session.last_reviewer_feedback = text;
}

export function appendReviewerFeedback(session, text) {
  session.last_reviewer_feedback = session.last_reviewer_feedback
    ? `${session.last_reviewer_feedback}\n${text}`
    : text;
}

export function setSonarSummary(session, text) {
  session.last_sonar_summary = text;
}

export function setSonarIssueSignature(session, sig) {
  session.last_sonar_issue_signature = sig;
}

export function setReviewerIssueSignature(session, sig) {
  session.last_reviewer_issue_signature = sig;
}

// Issue-signature repetition counters (distinct from retry_count:
// reset only when the signature changes, not every iteration).
export function setSonarRepeatCount(session, value) {
  session.sonar_repeat_count = Number(value) || 0;
}
export function setReviewerRepeatCount(session, value) {
  session.reviewer_repeat_count = Number(value) || 0;
}

// --- Status ---------------------------------------------------------------

/**
 * In-memory status change. The persisting variant is `markSessionStatus` in
 * store.js, which also writes to disk; `setStatus` is for transient mutations
 * inside the runner (e.g. standby enter/exit) where the caller persists
 * later via `saveSession`.
 */
export function setStatus(session, status) {
  session.status = status;
}

// --- Stage results (KJC-BUG-0058: resume must skip completed stages) ------

/**
 * Persist a pre-loop stage result on the session, plus mirror its name in
 * a flat `stages_completed` array used by `resumeFlow` to know what to skip.
 *
 * Both shapes are kept in sync so callers can read either: the rich
 * `stage_results[name]` for the full payload, or the cheap
 * `stages_completed` for a fast membership check.
 */
export function setStageResult(session, name, result) {
  if (!session.stage_results) session.stage_results = {};
  session.stage_results[name] = result;
  if (!Array.isArray(session.stages_completed)) session.stages_completed = [];
  if (!session.stages_completed.includes(name)) session.stages_completed.push(name);
}

/**
 * Stage *bundles* capture cross-stage context that a stage exports beyond
 * its stageResult (e.g. researcher → researchContext, architect →
 * architectContext, planner → plannedTask). Resume needs these to feed
 * downstream stages without re-running the upstream one. The bundle is
 * always shaped `{ stageResult, ...extras }` and `setStageBundle` mirrors
 * the stageResult into `stage_results[name]` so legacy readers keep working.
 */
export function setStageBundle(session, name, bundle) {
  if (!session.stage_bundles) session.stage_bundles = {};
  session.stage_bundles[name] = bundle;
  setStageResult(session, name, bundle?.stageResult ?? bundle);
}

// --- Alternative agent (rate-limit recovery) ------------------------------

export function setAlternativeAgent(session, stage, provider) {
  session._alternative_agent = { stage, provider };
}

export function clearAlternativeAgent(session) {
  delete session._alternative_agent;
}

// --- Standby state --------------------------------------------------------

export function setStandby(session, { agent, cooldownMs, cooldownUntil }) {
  session.standby_agent = agent;
  session.standby_cooldown_ms = cooldownMs;
  session.standby_cooldown_until = cooldownUntil;
}

export function clearStandby(session) {
  delete session.standby_agent;
  delete session.standby_cooldown_ms;
  delete session.standby_cooldown_until;
}

// --- CI state -------------------------------------------------------------

export function setCiEarlyPr(session, { prNumber, prUrl, commits }) {
  session.ci_pr_number = prNumber;
  session.ci_pr_url = prUrl;
  session.ci_commits = commits;
}

export function appendCiCommits(session, commits) {
  session.ci_commits = [...(session.ci_commits ?? []), ...commits];
}

// --- Pre-loop & policy metadata -------------------------------------------

export function setPreflight(session, result) {
  session.preflight = result;
}

export function setResolvedPolicies(session, policies) {
  session.resolved_policies = policies;
}

export function setPgCard(session, card) {
  session.pg_card = card;
}

export function setPgTaskId(session, id) {
  session.pg_task_id = id;
}

export function appendPgCommits(session, commits) {
  session.pg_commits = [...(session.pg_commits ?? []), ...commits];
}

export function setPreLoopContext(session, { research, architect, plan }) {
  if (research !== undefined) session.research_context = research;
  if (architect !== undefined) session.architect_context = architect;
  if (plan !== undefined) session.loaded_plan = plan;
}

export function setPlanRef(session, ref) {
  session._planRef = ref;
}

export function setPlanSyncCallback(session, fn) {
  session._syncResultsToPlan = fn;
}

/**
 * Live status updater: invoked by hu-sub-pipeline after every status
 * change so the plan JSON gets the new status immediately, not only at
 * the end of the run. Without this, the board reads an unchanged plan
 * file during execution and the columns appear frozen until the run
 * completes (the bug we're fixing in PR1).
 *
 * Signature: async (huId, status) => void
 */
export function setLiveStatusUpdater(session, fn) {
  session._liveStatusUpdater = fn;
}

export function getLiveStatusUpdater(session) {
  return session._liveStatusUpdater || null;
}

/**
 * Live outcome updater (PR3): invoked by hu-sub-pipeline after each
 * HU's runSingleHu finishes. The plan JSON gets the per-HU outcome
 * stamped immediately so the board can show a "📄 ver resumen"
 * indicator next to each card without waiting for the run to end.
 *
 * Signature: async (huId, outcome) => void
 */
export function setLiveOutcomeUpdater(session, fn) {
  session._liveOutcomeUpdater = fn;
}

export function getLiveOutcomeUpdater(session) {
  return session._liveOutcomeUpdater || null;
}

// --- Skills ---------------------------------------------------------------

export function setAddyosmaniSkills(session, payload) {
  session.addyosmaniSkills = payload;
}

export function setAutoInstalledSkills(session, skills) {
  session.autoInstalledSkills = skills;
}

export function setSkillsRecommended(session, skills) {
  session.skillsRecommended = skills;
}

// --- Journal breadcrumbs --------------------------------------------------

export function setJournalContext(session, { dir, files, iterations, decisions, startedAt }) {
  if (dir !== undefined) session._journalDir = dir;
  if (files !== undefined) session._journalFiles = files;
  if (iterations !== undefined) session._journalIterations = iterations;
  if (decisions !== undefined) session._journalDecisions = decisions;
  if (startedAt !== undefined) session._startedAt = startedAt;
}

// --- Session outcome ------------------------------------------------------

export function setBudget(session, budget) {
  session.budget = budget;
}

export function setDeferredIssues(session, issues) {
  session.deferred_issues = issues;
}

export function setRtkSavings(session, savings) {
  session.rtk_savings = savings;
}

// --- Paused state (resume) ------------------------------------------------

export function setPausedState(session, state) {
  session.paused_state = state;
}

// --- Brain decisions (decisor tracker) -----------------------------------

export function setBrainDecisions(session, decisions) {
  session.brainDecisions = decisions;
}

// --- Suggestions (MCP) ----------------------------------------------------

export function setSuggestions(session, suggestions) {
  session.suggestions = suggestions;
}

export function touch(session) {
  session.updated_at = new Date().toISOString();
}
