/**
 * KJC-TSK-1076: the requirements of a third-party PR, checked with no tokens.
 * Each check is {id, ok, detail}; none stops the review (the agent decides).
 * The rules are the own-work ones: the same budget, Conventional Commits and
 * attribution patterns, and tests-with-code.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_ATTRIBUTION, CONVENTIONAL_TYPES } from "../harden/hook-templates.js";
import { loadPolicy } from "../policy/engine.js";
import { runCommand } from "../utils/process.js";
import { budgetedAdded } from "./loc-budget.js";
import { checkTestsWithCode } from "./tests-with-code.js";

const HEADER_MAX = 100;
const CONVENTIONAL = new RegExp(String.raw`^(${CONVENTIONAL_TYPES})(\([^)]+\))?!?: \S`);
const ATTRIBUTION = new RegExp(AI_ATTRIBUTION, "i");

const rowsOf = (numstat) => numstat.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const [a, r, ...f] = l.split(/\s+/);
  return { file: f.join(" "), added: a === "-" ? 1 : Number(a) || 0, removed: r === "-" ? 0 : Number(r) || 0 };
});

/**
 * The PR size budget, one source for every gate (PL-C, KJC-TSK-0735): the
 * policy's net_lines_added invariant, else method_gates.pr_size_max, 200.
 */
export function prSizeLimit({ projectDir, config }) {
  const pol = loadPolicy({ projectDir });
  const inv = pol.errors.length === 0
    ? (pol.policy.invariants || []).find((i) => i.kind === "diff-threshold" && i.metric === "net_lines_added")
    : null;
  return {
    ideal: config?.method_gates?.pr_size_warn ?? 150,
    limit: inv?.max ?? config?.method_gates?.pr_size_max ?? 200,
    source: inv ? `policy [${inv.id}]` : "method_gates",
  };
}

/** Lines added that count against the budget (generated output and human docs exempt). */
export function sizeCheck({ numstat, limit }) {
  const { added, exempt } = budgetedAdded(numstat);
  const exemptNote = exempt > 0 ? ` (${exempt} exempt)` : "";
  return added > limit
    ? { id: "size", ok: false, detail: `${added} lines added${exemptNote}, over the ${limit}-line limit: partition the PR` }
    : { id: "size", ok: true, detail: `${added} lines added${exemptNote}, within the ${limit}-line limit` };
}

/** Conventional Commits headers (at most 100 characters) and no AI attribution in base..head. */
export function commitChecks(commits) {
  const badHeader = commits.filter((c) => !CONVENTIONAL.test(c.subject) || c.subject.length > HEADER_MAX);
  const attributed = commits.filter((c) => ATTRIBUTION.test(`${c.subject}\n${c.body}`));
  const list = (cs) => cs.map((c) => `${c.sha.slice(0, 8)} "${c.subject}"`).join(", ");
  return [
    badHeader.length
      ? { id: "conventional-commits", ok: false, detail: `not Conventional Commits or over ${HEADER_MAX} characters: ${list(badHeader)}` }
      : { id: "conventional-commits", ok: true, detail: `${commits.length} commit(s) with Conventional Commits headers` },
    attributed.length
      ? { id: "ai-attribution", ok: false, detail: `AI attribution in: ${list(attributed)}` }
      : { id: "ai-attribution", ok: true, detail: "no AI attribution in the commits" },
  ];
}

// KJC-TSK-1238 (#2263): a convention the reviewed repo declares (commitlint, kj's commit-msg hook).
const CONVENTION_FILES = [
  "commitlint.config.js", "commitlint.config.cjs", "commitlint.config.mjs", "commitlint.config.ts",
  ".commitlintrc", ".commitlintrc.json", ".commitlintrc.yml", ".commitlintrc.yaml", ".commitlintrc.js", ".commitlintrc.cjs",
  ".karajan/hooks/commit-msg",
];

export function declaresCommitConvention(projectDir) {
  if (CONVENTION_FILES.some((f) => existsSync(join(projectDir, f)))) return true;
  try {
    return Boolean(JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")).commitlint);
  } catch {
    return false; // no package.json, or not JSON: it declares nothing
  }
}

/**
 * Source changed with no test changed (a delete-only change needs none). On
 * someone else's PR test-first is kj's rule, not theirs (KJC-TSK-1238): a
 * change with no business logic needs no test, so it is a question, not a failure.
 */
export function testsCheck({ config, numstat }) {
  const rows = rowsOf(numstat);
  const res = checkTestsWithCode({ config, stagedFiles: rows.map((r) => r.file), numstat: rows });
  if (res.ok && res.mode !== "warn") return { id: "tests", ok: true, detail: `tests: ${res.mode}` };
  return {
    id: "tests", ok: null, detail: res.reason || "source changed with no test changed",
    question: "No test changed: does the change touch business logic, behaviour a unit, integration or E2E test could observe? A plain index, configuration or infrastructure needs none.",
  };
}

const git = async (projectDir, args) => {
  const res = await runCommand("git", args, { cwd: projectDir });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${(res.stderr || "").trim()}`);
  return res.stdout;
};

/** Size, commits and tests of base...head, read from git. */
export async function prRequirementChecks({ range, projectDir, config, run = git }) {
  const numstat = await run(projectDir, ["diff", "--numstat", range]);
  // The commits of a PR are base..head, whichever range notation was given.
  const [base, head] = range.split(/\.{2,3}/);
  const log = await run(projectDir, ["log", "--format=%H%x1f%s%x1f%b%x1e", `${base}..${head || "HEAD"}`]);
  const commits = log.split("\x1e").map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, subject = "", body = ""] = r.split("\x1f");
    return { sha, subject, body };
  });
  const [conventional, attribution] = commitChecks(commits);
  const commitFormat = declaresCommitConvention(projectDir)
    ? conventional
    : { id: "conventional-commits", ok: null, skipped: true, detail: "the repo declares no commit convention (no commitlint config, no kj commit-msg hook): not checked" };
  return [sizeCheck({ numstat, limit: prSizeLimit({ projectDir, config }).limit }), commitFormat, attribution, testsCheck({ config, numstat })];
}
