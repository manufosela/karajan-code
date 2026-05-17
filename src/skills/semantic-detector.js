/**
 * Semantic skill detection using the triage classifier.
 *
 * The regex-based detector (skill-detector.js) is fast but shallow: it only
 * catches dependencies that name themselves explicitly. A task like
 * "add a feature flag system" might benefit from an "a/b-testing" skill
 * that regex cannot guess without an exhaustive keyword list.
 *
 * Semantic mode asks the classifier agent to pick skills from a known
 * catalog given the task text and the skills already detected by regex.
 * The catalog is intentionally small and curated — we don't hit the
 * openskills.cc marketplace API (not available). If the classifier is
 * unavailable (missing provider / missing API key), we return [] and the
 * pipeline keeps working with the regex-only result.
 */

import { createAgent } from "../agents/index.js";
import { resolveRole } from "../config.js";
import { withBrainRecovery } from "../brain/with-brain-recovery.js";

/**
 * Curated catalog of skills the classifier is allowed to suggest. Keeping
 * this small prevents the model from hallucinating non-existent skills and
 * bounds the tokens spent on the prompt.
 */
export const SEMANTIC_CATALOG = [
  "astro", "nextjs", "react", "vue", "svelte", "angular",
  "express", "fastify", "nestjs",
  "java", "kotlin", "go", "rust", "ruby", "php", "dotnet", "elixir",
  "python", "python-data", "python-ml", "pytest-patterns",
  "django", "flask", "fastapi",
  "sql-analysis", "prisma", "mongodb",
  "owasp-top-10", "security-checklist",
  "java-code-review", "python-code-review",
  "frontend-design", "csv-transform", "data-report",
  "vitest-patterns", "jest-patterns", "playwright-patterns", "cypress-patterns",
];

const PROMPT = (task, catalog, alreadyDetected) => `You are a classifier that picks which domain skills would help solve a task.

Task:
"""${task}"""

Already detected skills (do NOT repeat, but consider the task context they imply):
${alreadyDetected.length > 0 ? alreadyDetected.join(", ") : "(none)"}

From this exact catalog, output a JSON array with the names of 0 to 5 additional skills that would meaningfully help. Output ONLY the JSON array, no prose.

Catalog (pick strict matches only):
${catalog.join(", ")}

Rules:
- Only names from the catalog. Do NOT invent.
- Prefer precision over recall: empty array is a valid answer when nothing fits.
- Do NOT include already-detected skills.
- Respond with a single JSON array, e.g. ["python-data","sql-analysis"]
`;

function tryParseArray(raw) {
  if (!raw) return [];
  try {
    const m = String(raw).match(/\[[^\]]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => typeof s === "string");
  } catch {
    return [];
  }
}

/**
 * Ask the classifier for additional skills.
 *
 * @param {Object} args
 * @param {string} args.task
 * @param {string[]} args.alreadyDetected
 * @param {Object} args.config - Karajan config
 * @param {Object} [args.logger]
 * @returns {Promise<string[]>}
 */
export async function refineSkillsSemantically({ task, alreadyDetected = [], config, logger }) {
  if (!task || typeof task !== "string") return [];
  let provider;
  try {
    provider = resolveRole(config, "triage")?.provider
      || resolveRole(config, "planner")?.provider
      || resolveRole(config, "coder")?.provider;
  } catch {
    provider = null;
  }
  if (!provider) {
    logger?.debug?.("semantic-detector: no classifier provider — skipping");
    return [];
  }

  let agent;
  try {
    agent = createAgent(provider, config, logger);
  } catch (err) {
    logger?.debug?.(`semantic-detector: classifier unavailable (${err.message}) — skipping`);
    return [];
  }
  if (!agent || typeof agent.runTask !== "function") {
    logger?.debug?.("semantic-detector: classifier agent has no runTask() — skipping");
    return [];
  }

  const prompt = PROMPT(task, SEMANTIC_CATALOG, alreadyDetected);
  // KJC-TSK-0413 step D: wrap with Brain Recovery. semantic-detector usa
  // signature legacy `runTask(prompt, opts)` — adapter normaliza al estándar
  // `runTask({ prompt, timeoutMs })` que withBrainRecovery espera.
  const adapter = {
    provider: agent.provider,
    runTask: (args) => agent.runTask(args.prompt, { timeoutMs: args.timeoutMs }),
  };
  let res;
  try {
    res = await withBrainRecovery({
      agent: adapter,
      taskArgs: { prompt, timeoutMs: 30_000 },
      role: "semantic-detector",
      logger,
    });
  } catch (err) {
    logger?.warn?.(`semantic-detector: classifier call failed (${err.message}) — skipping`);
    return [];
  }
  if (!res?.ok) {
    // En test env el sleep es no-op así que abort viene rápido. Skip-on-fail
    // sigue siendo el comportamiento — semantic detection es best-effort.
    logger?.debug?.(`semantic-detector: classifier returned not-ok (${res?.recovery?.class || "unknown"}) — skipping`);
    return [];
  }

  const suggested = tryParseArray(res.output || res.result?.raw || "");
  const allowed = new Set(SEMANTIC_CATALOG);
  const alreadySet = new Set(alreadyDetected.map((s) => s.toLowerCase()));
  return suggested
    .map((s) => String(s).trim())
    .filter((s) => s && allowed.has(s) && !alreadySet.has(s.toLowerCase()))
    .slice(0, 5);
}

/**
 * Resolve the effective skills mode from config + flags.
 * Precedence: flags.skillsMode > config.skills.mode > config.testHarness.defaultSkillsMode > "auto".
 *
 * The testHarness default lets the test harness opt out of semantic
 * detection without each orchestrator test having to mock this module.
 * Production code reads `config.testHarness.defaultSkillsMode` only;
 * the legacy global override is documented and exclusively read in
 * src/config/test-harness.js (ESLint rule #557 blocks any reintroduction
 * of `globalThis.__KJ_*` outside that one file). Legacy callers without
 * a fully-loaded config still work because `config.testHarness` is
 * undefined → falls through to `"auto"`.
 *
 * @param {Object} config
 * @param {Object} [flags]
 * @returns {"auto"|"regex"|"semantic"|"none"}
 */
export function resolveSkillsMode(config, flags = {}) {
  const defaultMode = config?.testHarness?.defaultSkillsMode || "auto";
  const candidate = flags.skillsMode ?? config?.skills?.mode ?? defaultMode;
  const valid = new Set(["auto", "regex", "semantic", "none"]);
  return valid.has(candidate) ? candidate : "auto";
}
