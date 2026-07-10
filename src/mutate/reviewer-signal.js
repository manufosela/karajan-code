/**
 * Reviewer opt-in mutation signal (KJC-TSK-0588). OFF by default: only when
 * `KJ_REVIEW_MUTATION` is set does the reviewer run `kj mutate` scoped to the
 * diff and fold surviving mutants into its verdict as a weak-test signal.
 * A null return means "add nothing" → the default-off prompt stays identical.
 */

import { mutateCommand } from "../commands/mutate.js";

const DEFAULT_SINCE = "HEAD~1";
const ENABLED = /^(1|true|yes|on)$/i;

/** True when the reviewer mutation opt-in is switched on via env. */
export function isMutationReviewEnabled(env = process.env) {
  return ENABLED.test(String(env?.KJ_REVIEW_MUTATION ?? "").trim());
}

// Drives `kj mutate --json` over the diff, capturing its output instead of
// printing it, and returns {code, result} where result is the normalized JSON.
async function defaultRun({ since, projectDir }) {
  const lines = [];
  const code = await mutateCommand({
    since,
    projectDir,
    json: true,
    maxSurvivors: Number.POSITIVE_INFINITY,
    logger: { info: (m) => lines.push(String(m)) },
  });
  const jsonLine = [...lines].reverse().find((l) => l.trim().startsWith("{"));
  return { code, result: jsonLine ? JSON.parse(jsonLine) : null };
}

function unavailableNote() {
  return [
    "## Mutation testing (advisory)",
    "Mutation testing was requested but could not run on this diff (unsupported",
    "stack or tool unavailable). Treat it as unavailable — do not infer test",
    "quality from its absence.",
  ].join("\n");
}

function survivorSection(survivors) {
  const lines = survivors.map((s) => `- ${s.file}:${s.line ?? "?"} (${s.mutator ?? s.status})`);
  return [
    "## Mutation testing (advisory signal)",
    "The following mutants survived over the changed lines — the tests did not",
    "catch these deliberate defects, so the covering tests are weak. Weigh this",
    "as a signal about test quality, not as a hard blocker on its own:",
    ...lines,
  ].join("\n");
}

/**
 * Build the reviewer's mutation-signal prompt section, or null to add nothing.
 * `run` ({since, projectDir}) → {code, result} is injectable for tests.
 * @returns {Promise<string|null>}
 */
export async function buildReviewerMutationSignal({
  enabled,
  since = DEFAULT_SINCE,
  projectDir = process.cwd(),
  run = defaultRun,
} = {}) {
  if (!enabled) return null;
  let outcome;
  try {
    outcome = await run({ since, projectDir });
  } catch {
    return unavailableNote();
  }
  const { code, result } = outcome ?? {};
  if (code === 1 || code === 2) return unavailableNote();
  const survivors = result?.survived ?? [];
  if (survivors.length === 0) return null;
  return survivorSection(survivors);
}
