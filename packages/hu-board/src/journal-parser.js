/**
 * Journal parser — reads `.reviews/<sessionId>/` artefacts produced by Karajan's
 * session journal writers (decisions.md, iterations.md, summary.md, tree.txt)
 * and exposes them as structured JSON for the /pipeline dashboard.
 *
 * Scope: zero new runtime dependencies. Uses only node:fs + node:path.
 * Poll-friendly: every call re-reads from disk so the UI can refresh by
 * hitting the API endpoint on an interval (1-2 s). No WebSocket, no SSE —
 * keeps the surface minimal (TSK-0325).
 *
 * Input layout (as written by src/session/journal/*):
 *
 *   <projectDir>/.reviews/<sessionId>/
 *     ├─ decisions.md     — Brain / Solomon / standby / checkpoint decisions
 *     ├─ iterations.md    — per-iteration coder/reviewer/sonar/solomon detail
 *     ├─ summary.md       — executive view: stages, budget, links
 *     └─ tree.txt         — directory-grouped file status
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Resolve the directory where session journals live. Honours KJ_PROJECT_DIR
 * for the common "hu-board runs in a different process from the pipeline"
 * case; otherwise falls back to the current working directory.
 */
function getProjectDir() {
  return process.env.KJ_PROJECT_DIR || process.cwd();
}

/**
 * Resolve the `.reviews/` directory under the active project dir.
 */
function getReviewsDir() {
  return path.join(getProjectDir(), ".reviews");
}

/**
 * List available sessions. Each entry points at a `.reviews/<sessionId>/`
 * directory that has been produced by Karajan's journal writers.
 *
 * @returns {Array<{id: string, journalPath: string, mtimeMs: number}>}
 */
export function listSessions() {
  const reviewsDir = getReviewsDir();
  if (!fs.existsSync(reviewsDir)) return [];
  const entries = fs.readdirSync(reviewsDir, { withFileTypes: true });
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(reviewsDir, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(dir).mtimeMs;
    } catch { /* stat failed — skip this entry */ }
    sessions.push({ id: entry.name, journalPath: dir, mtimeMs });
  }
  // Most recent first — what the UI wants by default.
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions;
}

/**
 * Split a markdown doc into `## Heading` blocks. Keeps the heading name
 * and the body under it.
 * @param {string} md
 * @returns {Array<{heading: string, body: string}>}
 */
export function splitByHeading(md, level = 2) {
  if (!md) return [];
  const prefix = "#".repeat(level) + " ";
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith(prefix) && !line.startsWith(prefix + "# ")) {
      if (current) blocks.push(current);
      current = { heading: line.slice(prefix.length).trim(), body: "" };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/**
 * Parse iterations.md into a list of iteration objects. The journal writer
 * (src/session/journal/iteration-logger.js) produces `## Iteration N`
 * sections, each with `### Stage` sub-blocks (Coder, Reviewer, Sonar, …).
 *
 * @param {string} md
 * @returns {Array<{number: number, title: string, duration?: string, stages: Array<{name: string, body: string}>}>}
 */
export function parseIterations(md) {
  return splitByHeading(md, 2).map((block) => {
    const match = block.heading.match(/Iteration\s+(\d+)/i);
    const number = match ? Number(match[1]) : 0;
    const durationMatch = block.body.match(/\*\*Duration\*\*:\s*([^\n]+)/i);
    const duration = durationMatch ? durationMatch[1].trim() : null;
    const stages = splitByHeading(block.body, 3).map((s) => ({
      name: s.heading,
      body: s.body.trim(),
    }));
    return { number, title: block.heading, duration, stages };
  });
}

/**
 * Parse decisions.md into structured records. The writer uses
 * `## <timestamp> — <decisionType>` headings; fall back to a flat list
 * when the format drifts.
 *
 * @param {string} md
 * @returns {Array<{heading: string, body: string}>}
 */
export function parseDecisions(md) {
  return splitByHeading(md, 2).map((b) => ({
    heading: b.heading,
    body: b.body.trim(),
  }));
}

/**
 * Parse summary.md into { preamble, sections }. The preamble is anything
 * before the first `## Heading`.
 *
 * @param {string} md
 * @returns {{preamble: string, sections: Array<{heading: string, body: string}>}}
 */
export function parseSummary(md) {
  const sections = splitByHeading(md, 2);
  const firstHeadingIdx = md.indexOf("## ");
  const preamble = firstHeadingIdx === -1 ? md.trim() : md.slice(0, firstHeadingIdx).trim();
  return { preamble, sections };
}

/**
 * Read a file defensively — returns null when missing, the content when
 * present. Lets `readJournal` return a consistent shape even when the
 * pipeline wrote some artefacts but not others.
 */
function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Read + parse the four journal artefacts for a given session. Always
 * returns an object with the same keys so the client has predictable
 * defaults.
 *
 * @param {string} sessionId
 */
export function readJournal(sessionId) {
  const dir = path.join(getReviewsDir(), sessionId);
  const iterationsRaw = readIfExists(path.join(dir, "iterations.md"));
  const decisionsRaw = readIfExists(path.join(dir, "decisions.md"));
  const summaryRaw = readIfExists(path.join(dir, "summary.md"));
  const treeRaw = readIfExists(path.join(dir, "tree.txt"));
  return {
    id: sessionId,
    journalPath: dir,
    exists: fs.existsSync(dir),
    iterations: iterationsRaw ? parseIterations(iterationsRaw) : [],
    decisions: decisionsRaw ? parseDecisions(decisionsRaw) : [],
    summary: summaryRaw ? parseSummary(summaryRaw) : { preamble: "", sections: [] },
    tree: treeRaw || "",
    raw: {
      iterations: iterationsRaw,
      decisions: decisionsRaw,
      summary: summaryRaw,
      tree: treeRaw,
    },
  };
}
