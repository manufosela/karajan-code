/**
 * KJC-TSK-1386 (ADR 0045): what the project itself says about an adjustable rule, found
 * without a model and with its evidence. Today: the commit convention, from the project's
 * own commitlint config, else from its git history.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CONVENTIONAL_TYPES } from "../harden/hook-templates.js";

const COMMITLINT_FILES = [
  "commitlint.config.js", "commitlint.config.cjs", "commitlint.config.mjs", "commitlint.config.ts",
  ".commitlintrc", ".commitlintrc.json", ".commitlintrc.yml", ".commitlintrc.yaml", ".commitlintrc.js", ".commitlintrc.cjs",
];
const KJ_MANAGED = "kj:managed:commitlint"; // the config kj harden writes is not the project's word
const TYPES = new Set(CONVENTIONAL_TYPES.split("|"));
const HEADER = /^([a-z]+)(\([^)]+\))?!?: ./;
const isConventional = (subject) => TYPES.has(HEADER.exec(subject)?.[1]);
const HISTORY = 50;
const MIN_TO_JUDGE = 10;

const defaultDeps = (projectDir) => ({
  readFile: (rel) => readFileSync(join(projectDir, rel), "utf8"),
  gitSubjects: () => execFileSync("git", ["-C", projectDir, "log", `-n${HISTORY}`, "--format=%s"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split("\n").filter(Boolean),
});

const tryRead = (readFile, rel) => { try { return readFile(rel); } catch { return null; } };

function ownCommitlint(readFile) {
  for (const rel of COMMITLINT_FILES) {
    const text = tryRead(readFile, rel);
    if (text !== null && !text.includes(KJ_MANAGED)) return rel;
  }
  try {
    if (JSON.parse(tryRead(readFile, "package.json") ?? "{}").commitlint) return "package.json (commitlint)";
  } catch { /* an unreadable package.json says nothing about commits */ }
  return null;
}

/** @returns {Record<string, {value: string, evidence: string}>} by rule id; empty when the project says nothing */
export function detectProjectConventions(projectDir, deps = defaultDeps(projectDir)) {
  const own = ownCommitlint(deps.readFile);
  if (own) return { "commit-convention": { value: "project", evidence: own } };
  let subjects = [];
  try { subjects = deps.gitSubjects(); } catch { /* no history yet: nothing to judge */ }
  if (subjects.length < MIN_TO_JUDGE) return {};
  const conventional = subjects.filter(isConventional).length;
  if (conventional * 2 >= subjects.length) return {};
  return { "commit-convention": { value: "free", evidence: `git history: ${conventional} of the last ${subjects.length} commits follow Conventional Commits` } };
}
