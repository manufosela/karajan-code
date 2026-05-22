// Verification gate: checks whether the coder actually produced changes.
// Prevents advancing the pipeline when coder iterations produce 0 file changes.

import { execFileSync } from "node:child_process";

/**
 * @typedef {Object} VerificationResult
 * @property {boolean} passed - true if coder produced real changes
 * @property {number} filesChanged - count of modified/added/deleted files
 * @property {number} linesChanged - total lines added/deleted
 * @property {string[]} files - list of changed file paths
 * @property {string} reason - explanation when not passed
 * @property {string} [retryStrategy] - suggested retry approach when not passed
 */

/**
 * Count files and lines changed since a base reference.
 * Uses git diff --numstat to get both file and line counts.
 *
 * Audit follow-up: was using execSync with template-string interpolation
 * of `baseRef` and `projectDir`. Both come ultimately from session
 * state / config — not user shell input — but the shape was a known
 * shell-injection vector. Switched to execFileSync with arg arrays so
 * no interpolation reaches /bin/sh.
 */
export function countChangesSince(baseRef, projectDir = null) {
  try {
    const args = ["diff", "--numstat", String(baseRef)];
    if (projectDir) args.push("--", String(projectDir));
    const output = execFileSync("git", args, {
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!output) return { files: [], filesChanged: 0, linesAdded: 0, linesDeleted: 0 };

    const lines = output.split("\n");
    const files = [];
    let linesAdded = 0;
    let linesDeleted = 0;

    for (const line of lines) {
      const [added, deleted, file] = line.split("\t");
      if (!file) continue;
      files.push(file);
      linesAdded += Number(added) || 0;
      linesDeleted += Number(deleted) || 0;
    }

    return { files, filesChanged: files.length, linesAdded, linesDeleted };
  } catch (err) {
    // Git itself failed (baseRef invalid, repo corrupt, git binary
    // missing). Previously we returned `filesChanged: 0` silently —
    // indistinguishable from "the coder did nothing". Surface the
    // error so verifyCoderOutput stops blaming the agent for an
    // infrastructure failure.
    return {
      files: [], filesChanged: 0, linesAdded: 0, linesDeleted: 0,
      gitError: err?.stderr?.toString?.() || err?.message || String(err),
    };
  }
}

/**
 * Also count untracked files (new files not yet added to git).
 *
 * Audit follow-up: same execSync→execFileSync change as countChangesSince.
 */
export function countUntrackedFiles(projectDir = null) {
  try {
    const args = ["ls-files", "--others", "--exclude-standard"];
    if (projectDir) args.push(String(projectDir));
    const output = execFileSync("git", args, {
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!output) return { files: [] };
    return { files: output.split("\n").filter(Boolean) };
  } catch (err) {
    return {
      files: [],
      gitError: err?.stderr?.toString?.() || err?.message || String(err),
    };
  }
}

/**
 * Verify that the coder produced real changes.
 * Counts both tracked changes and untracked files.
 *
 * @param {Object} params
 * @param {string} params.baseRef - git reference to compare against
 * @param {string} [params.projectDir] - directory scope
 * @param {number} [params.minFiles=1] - minimum files that must change
 * @param {number} [params.minLines=1] - minimum lines that must change
 * @returns {VerificationResult}
 */
export function verifyCoderOutput({ baseRef, projectDir = null, minFiles = 1, minLines = 1 }) {
  const tracked = countChangesSince(baseRef, projectDir);
  const untracked = countUntrackedFiles(projectDir);

  // Git infra failure (bad baseRef, corrupt repo, git missing) — not
  // the coder's fault. Bail out with `gitError` so the caller can log
  // it and skip the "retry with explicit file paths" feedback that
  // would otherwise blame the agent.
  const gitError = tracked.gitError || untracked.gitError;
  if (gitError) {
    return {
      passed: false,
      filesChanged: 0,
      linesChanged: 0,
      files: [],
      reason: `Git verification failed: ${gitError}`,
      retryStrategy: null,
      gitError,
    };
  }

  const untrackedFiles = untracked.files || [];
  const totalFiles = tracked.filesChanged + untrackedFiles.length;
  const totalLines = tracked.linesAdded + tracked.linesDeleted;
  const allFiles = [...tracked.files, ...untrackedFiles];

  const passed = totalFiles >= minFiles && (untrackedFiles.length > 0 || totalLines >= minLines);

  if (passed) {
    return {
      passed: true,
      filesChanged: totalFiles,
      linesChanged: totalLines,
      files: allFiles,
      reason: "",
      retryStrategy: null
    };
  }

  return {
    passed: false,
    filesChanged: totalFiles,
    linesChanged: totalLines,
    files: allFiles,
    reason: totalFiles === 0
      ? "Coder produced 0 file changes"
      : `Only ${totalFiles} file(s) and ${totalLines} line(s) changed (below minimum)`,
    retryStrategy: buildRetryStrategy(totalFiles, totalLines)
  };
}

/**
 * Build a retry strategy based on the verification failure.
 */
function buildRetryStrategy(filesChanged, _linesChanged) {
  if (filesChanged === 0) {
    return "Rephrase the feedback with explicit file paths. List specific files to create/modify. Include example code snippets.";
  }
  return "Expand the prompt with more specific instructions. Break the task into smaller concrete steps.";
}

/**
 * Track consecutive verification failures to detect stuck loops.
 */
export class VerificationTracker {
  constructor() {
    this.consecutiveFailures = 0;
    this.history = [];
  }

  record(result) {
    this.history.push({ ...result, timestamp: Date.now() });
    if (result.passed) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures += 1;
    }
  }

  isStuck(threshold = 2) {
    return this.consecutiveFailures >= threshold;
  }

  getLastFailure() {
    return [...this.history].reverse().find(h => !h.passed) || null;
  }
}
