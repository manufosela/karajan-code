/**
 * Sonar pre-gate for `kj review --staged` (KJC-TSK-0676, user request
 * 2026-07-23). With the brain outside the core (v4), skipping sonar is one
 * decision away — proven the day the brain itself shipped 3 sonar issues in
 * new code. Hung off the review gate, it becomes a gate, not discipline:
 * deterministic findings on the STAGED files come back before any AI
 * verdict, and BLOCKER/CRITICAL ones reject without spending reviewer
 * tokens. Unavailable sonar degrades loudly ({available:false, reason}) —
 * a laptop without Docker still commits.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { indexedFilesFrom, runSonarScan } from "../sonar/scanner.js";
import { getOpenIssues } from "../sonar/api.js";
import { acquireToolLock } from "../utils/tool-governor.js";
import { sourceFilesOf } from "./tests-with-code.js";

const BLOCKING_SEVERITIES = new Set(["BLOCKER", "CRITICAL"]);

/** Repo-relative path of a sonar issue (component is "<projectKey>:<path>"). */
export function issueFile(issue) {
  const component = String(issue?.component || "");
  const idx = component.indexOf(":");
  return idx === -1 ? component : component.slice(idx + 1);
}

/** One printable line per finding: (SEVERITY) [file:line] rule — message. */
export function formatSonarFinding(issue) {
  const line = issue.line ? `:${issue.line}` : "";
  return `(${issue.severity}) [${issueFile(issue)}${line}] ${issue.rule} — ${issue.message}`;
}

/**
 * KJC-TSK-0795 AC3: the NEW line numbers each file gains in a unified diff
 * (`git diff --unified=0`). Only what the diff ADDS can be the author's fault.
 * @param {string} diffText @returns {Map<string, Set<number>>}
 */
export function addedLinesByFile(diffText) {
  const map = new Map();
  let current = null;
  for (const raw of String(diffText || "").split("\n")) {
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim();
      current = p.startsWith("b/") ? p.slice(2) : p === "/dev/null" ? null : p;
      continue;
    }
    const h = current ? /^@@ [^+]*\+(\d+)(?:,(\d+))? @@/.exec(raw) : null;
    if (!h) continue;
    const start = Number(h[1]);
    const count = h[2] === undefined ? 1 : Number(h[2]);
    if (count === 0) continue;
    const set = map.get(current) ?? map.set(current, new Set()).get(current);
    for (let i = 0; i < count; i++) set.add(start + i);
  }
  return map;
}

/**
 * Scan the project (single-flight via the tool governor) and return the
 * open issues that live on the staged files, split by blocking severity.
 * Every failure path degrades to {available:false, reason} — the pre-gate
 * never breaks the review, it only refuses to stay silent.
 */
/**
 * KJC-TSK-0838 step 3 (monorepo): each staged file belongs to the nearest
 * directory up from it that owns a sonar-project.properties; the repo root
 * ("") owns the rest. One scan per group, run from that directory.
 * @returns {Map<string, string[]>} repo-relative dir → staged files
 */
export function groupByScanRoot(files, { root = process.cwd(), exists = existsSync } = {}) {
  const groups = new Map();
  for (const file of files) {
    let owner = "";
    for (let dir = dirname(file); dir && dir !== "."; dir = dirname(dir)) {
      if (exists(join(root, dir, "sonar-project.properties"))) { owner = dir; break; }
    }
    (groups.get(owner) ?? groups.set(owner, []).get(owner)).push(file);
  }
  return groups;
}

export async function runSonarPregate({ config, stagedFiles = [], touchedLines = null, logger = null, exists = existsSync }) {
  if (config?.review_gate?.sonar === false) {
    return { available: false, reason: "disabled in config (review_gate.sonar: false)" };
  }
  let lock = null;
  try {
    lock = await acquireToolLock("sonar-scanner", { timeoutMs: 300_000 });
    const groups = groupByScanRoot(stagedFiles, { exists });
    if (groups.size === 0) groups.set("", []);
    const indexed = new Set();
    const issues = [];
    const keys = [];
    let totalProject = 0;
    for (const dir of groups.keys()) {
      const prefix = dir ? `${dir}/` : "";
      // KJC-TSK-0838: verbose, so the scanner names every file it indexed.
      const scan = await runSonarScan(config, null, { verbose: true, ...(dir ? { cwd: join(process.cwd(), dir) } : {}) });
      if (scan.note) logger?.warn?.(scan.note); // KJC-BUG-0156: precedence is said, never silent
      if (!scan.ok) {
        return { available: false, reason: (scan.stderr || scan.stdout || "sonar scan failed").trim() };
      }
      // Coverage is PROVED by the scanner's own index, never inferred from
      // config — a root-scoped properties file let 4 PRs under packages/radar
      // pass as "0 issues on staged files". No index in the log = no proof.
      const own = indexedFilesFrom(scan.stdout);
      if (own.size === 0) {
        return { available: false, reason: `the scanner log names no indexed file (sonar.verbose) — coverage cannot be proved for ${dir || "the repo root"}` };
      }
      for (const f of own) indexed.add(`${prefix}${f}`);
      keys.push(scan.projectKey);
      // The scan above ALWAYS runs before issues are read (single-flight): the
      // verdict is about the code as it is now, never a stale server analysis
      // (KJC-TSK-0795 AC2 — that failure mode has no route here, by design).
      const res = await getOpenIssues(config, scan.projectKey);
      totalProject += res.total ?? (res.issues || []).length;
      // Issue components are package-relative: made repo-relative here.
      for (const i of res.issues || []) issues.push({ ...i, component: `${scan.projectKey}:${prefix}${issueFile(i)}` });
    }
    const { sources } = sourceFilesOf(config, stagedFiles);
    const covered = sources.filter((f) => indexed.has(f));
    const uncovered = sources.filter((f) => !indexed.has(f));
    const staged = new Set(stagedFiles);
    const onStaged = issues.filter((i) => staged.has(issueFile(i)));
    // KJC-TSK-0795 AC3: with the diff's line map, only issues on lines the PR
    // ADDS can veto — a 3-line PR must not answer for 30 preexisting issues.
    // No line, or an untouched line, is the file's TREND: reported, never a block.
    const isTouched = (i) => !touchedLines || (i.line != null && touchedLines.get(issueFile(i))?.has(Number(i.line)));
    const mine = onStaged.filter(isTouched);
    return {
      available: true,
      projectKey: keys.join(","),
      covered,
      uncovered,
      blocking: mine.filter((i) => BLOCKING_SEVERITIES.has(String(i.severity).toUpperCase())),
      advisory: mine.filter((i) => !BLOCKING_SEVERITIES.has(String(i.severity).toUpperCase())),
      preexisting: touchedLines ? onStaged.filter((i) => !isTouched(i)) : [],
      totalProject,
    };
  } catch (err) {
    logger?.warn?.(`[sonar-pregate] ${err.message}`);
    return { available: false, reason: err.message };
  } finally {
    lock?.release?.();
  }
}
