// HU-4855 (KJC-TSK-1768): the repo's traces turned into day/piece/outcome counters, never their content.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const OUTCOMES = new Map(Object.entries({ pass: "pass", allow: "pass", ok: "pass", refuse: "fail", deny: "deny", exempt: "exempt" }));
const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
// The only rule names that leave: the Sentinel's doc anchors (src/harden/sentinel) and the commit-msg rules (hook-templates.js).
const RULES = new Set(["attribution", "bash-write", "board-sync", "card-first", "claims", "commit-gate", "commit-verdict",
  "cross-lane", "delegate", "discard", "escapes", "fail-closed", "governance", "handoff", "identity", "merge", "policy",
  "rag-first", "release", "report-issue", "steward", "supervisor",
  "body", "commitlint", "full-stop", "global-hook", "header", "length", "repo-hook", "subject-case"]);
const ANCHOR = /karajancode\.com\/docs\/guides\/sentinel\/#([a-z-]+)/g;
const PIECES = new Set(["tdd", "steward", "sonar"]); // the ones src/review/method-trace.js writes
const CHOKEPOINTS = new Set(["commit", "panel", "review", "supervisor", "tool"]); // the ones src seals decisions at
const known = (names, name) => (names.has(name) ? name : "other");

/** A known rule name, never trace content: the why's head, else the doc anchor its deny ends with, else "other". */
export function ruleOf(why) {
  const text = String(why ?? "");
  const head = text.split("\n")[0].replace(/^karajan sentinel: /, "").split(" — ")[0].trim();
  const anchor = [...text.matchAll(ANCHOR)].at(-1)?.[1];
  return [head, anchor].find((name) => RULES.has(name)) ?? "other";
}

const SOURCES = [
  { name: "sentinel", file: ".karajan/traces/denials.jsonl", map: (r) => ({ piece: "sentinel", raw: "deny", rule: ruleOf(r.why) }) },
  { name: "commit-gate", file: ".karajan/traces/commit-gate.jsonl",
    map: (r) => ({ piece: "commit-gate", raw: r.outcome, rule: r.outcome === "pass" ? null : ruleOf(r.rule) }) },
  { name: "method", file: ".karajan/traces/method.jsonl", map: (r) => ({ piece: known(PIECES, r.piece), raw: r.outcome }) },
  { name: "policy", file: ".karajan/policy-decisions.jsonl",
    map: (r) => ({ piece: `policy-${known(CHOKEPOINTS, r.chokepoint)}`, raw: r.decision }) },
];

function readRecords(path) {
  const where = (n) => `${basename(path)} line ${n}`;
  return readFileSync(path, "utf8").split("\n").flatMap((text, i) => {
    if (!text.trim()) return [];
    let record;
    try { record = JSON.parse(text); } catch { throw new Error(`${where(i + 1)}: not JSON`); }
    const stamp = record?.at ?? record?.ts;
    const instant = typeof stamp === "string" && ZONED_ISO.test(stamp) ? Date.parse(stamp) : Number.NaN;
    if (Number.isNaN(instant)) throw new Error(`${where(i + 1)}: no valid ISO timestamp`);
    return [{ record, day: new Date(instant).toISOString().slice(0, 10) }];
  });
}

const byKey = (a, b) => a.day.localeCompare(b.day) || a.piece.localeCompare(b.piece) || a.outcome.localeCompare(b.outcome);
const topRule = (blocks) => [...blocks].map(([rule, count]) => ({ rule, count }))
  .toSorted((a, b) => b.count - a.count || a.rule.localeCompare(b.rule))[0] ?? null;

/** Counts every trace of the repo per UTC day, piece and normalised outcome. */
export function traceCounters(projectDir) {
  const missing = [];
  const counts = new Map();
  const blocks = new Map();
  for (const source of SOURCES) {
    const path = join(projectDir, source.file);
    if (!existsSync(path)) { missing.push(source.name); continue; }
    for (const { record, day } of readRecords(path)) {
      const { piece, raw, rule } = source.map(record);
      const outcome = OUTCOMES.get(raw) ?? "fail";
      const key = JSON.stringify([day, piece, outcome]);
      counts.set(key, { day, piece, outcome, count: (counts.get(key)?.count ?? 0) + 1 });
      if (rule) blocks.set(rule, (blocks.get(rule) ?? 0) + 1);
    }
  }
  return { missing: missing.toSorted(), rows: [...counts.values()].toSorted(byKey), topBlockingRule: topRule(blocks) };
}
