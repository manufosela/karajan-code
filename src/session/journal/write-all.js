/**
 * Session-journal writer shared by every terminal path (KJC-BUG-0084).
 *
 * Pre-fix, the iterations/decisions/tree/summary block lived inline in
 * finalizeApprovedSession(), so a run that died on a stage error
 * (sonar_repeat, gh pr create failure, thrown stage) left only triage.md
 * behind — the Cache hits table, the budget breakdown and the commit list
 * vanished exactly on the runs where they matter most. This module is the
 * single writer; the approved path calls it with its enriched extras and
 * flow-runner's `finally` calls it best-effort for every other ending.
 *
 * Never throws: a journal failure must not mask the run's real result.
 */

import { writeIterationsJournal } from "../../orchestrator/session-journal.js";
import { listCommitsBetween } from "../../utils/git.js";

/**
 * Write iterations.md, decisions.md, tree.txt and summary.md for a session.
 *
 * @param {object} args
 * @param {object} args.session - live session (needs _journalDir to write)
 * @param {{info?: Function, warn?: Function}} [args.logger]
 * @param {string} [args.result] - summary badge: APPROVED | FAILED | STOPPED…
 * @param {number} [args.iterations]
 * @param {object|null} [args.budget] - budgetSummary() snapshot
 * @param {object} [args.stages] - stageResults map
 * @param {Array}  [args.commits] - precomputed commit list; computed from
 *   session_start_sha when omitted
 * @param {object|null} [args.planAdherence]
 * @returns {Promise<{written: boolean, reason?: string}>}
 */
export async function writeSessionJournal({ session, logger, result = "APPROVED", iterations = 0, budget = null, stages = {}, commits = null, planAdherence = null }) {
  const journalDir = session?._journalDir;
  if (!journalDir) return { written: false, reason: "no journal dir" };

  try {
    await writeIterationsJournal(journalDir, session._journalIterations || []);
    const { writeDecisionsJournal } = await import("./decisions-writer.js");
    const decisionsResult = await writeDecisionsJournal(session, { journalDir, logger });
    const { writeTreeJournal } = await import("./tree-writer.js");
    const treeResult = await writeTreeJournal(journalDir, session.session_start_sha, { logger });

    const journalFiles = [...(session._journalFiles || [])];
    if (session._journalIterations?.length) journalFiles.push("iterations.md");
    if (decisionsResult.written) journalFiles.push("decisions.md");
    if (treeResult.written) journalFiles.push("tree.txt");

    // Commit range from session start so the summary shows every commit
    // the run produced, not just the post-loop scaffold (2026-05-07
    // dogfooding). try/catch tolerates promise rejection AND a sync
    // undefined return from a resetAllMocks-stripped test mock.
    let summaryCommits = Array.isArray(commits) ? commits : null;
    if (!summaryCommits) {
      try { summaryCommits = (await listCommitsBetween(session.head_at_start || session.session_start_sha)) || []; }
      catch { summaryCommits = []; }
    }

    const { writeSummaryJournal } = await import("./summary-writer.js");
    const startedAt = session._startedAt ? new Date(session._startedAt).toISOString() : undefined;
    await writeSummaryJournal(journalDir, {
      task: session.task,
      result,
      sessionId: session.id,
      iterations,
      durationMs: Date.now() - (session._startedAt || Date.now()),
      budget,
      stages,
      commits: summaryCommits,
      files: journalFiles,
      startedAt,
      finishedAt: new Date().toISOString(),
      brainDecisions: Array.isArray(session.brainDecisions) ? session.brainDecisions.length : 0,
      solomonInvocations: Array.isArray(session.solomonRulings) ? session.solomonRulings.length : 0,
      skills: {
        addyosmani: session.addyosmaniSkills,
        installed: session.autoInstalledSkills,
        recommended: session.skillsRecommended,
      },
      planAdherence,
    }, { logger });
    session._journalWritten = true;
    logger?.info?.(`Session journal written to ${journalDir}`);
    return { written: true };
  } catch (err) {
    logger?.warn?.(`Journal write failed (non-blocking): ${err.message}`);
    return { written: false, reason: err.message };
  }
}
