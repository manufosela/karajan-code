// HU-4870 (KJC-TSK-1761): kj review --staged runs the diff's own test files before the reviewer;
// a red one ends the review in a rejection without calling the model.
import { existsSync } from "node:fs";
import path from "node:path";
import { runCommand } from "../utils/process.js";
import { detectTestFramework, TEST_PATTERNS_BY_LANGUAGE } from "../utils/project-detect.js";

const TAIL_LINES = 40;
const MAX_OUTPUT_CHARS = 3000;
const TEST_PATTERNS = [...new Set(Object.values(TEST_PATTERNS_BY_LANGUAGE).flat())].filter((p) => !p.startsWith("#["));

/** The files of the diff that are tests, in their order. */
export function diffTestFiles(files) {
  return files.filter((file) => TEST_PATTERNS.some((pattern) => `/${file}`.includes(pattern)));
}

function runnerFor({ framework, language }, files) {
  if (framework === "vitest") return { name: "vitest", command: "npx", args: ["vitest", "run", ...files] };
  if (framework === "jest") return { name: "jest", command: "npx", args: ["jest", ...files] };
  if (framework === "pytest" || language === "python") return { name: "pytest", command: "python", args: ["-m", "pytest", ...files] };
  return null;
}

function outputTail({ stdout = "", stderr = "" }) {
  const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-TAIL_LINES).join("\n");
  return tail.length > MAX_OUTPUT_CHARS ? tail.slice(-MAX_OUTPUT_CHARS) : tail;
}

const PACKAGE_MARKERS = ["package.json", "pyproject.toml"];

/** The repo-relative dir (posix, "" for the root) of the nearest package holding the file, not past the root. */
function packagePrefix(projectDir, file) {
  const segments = path.posix.dirname(file).split("/").filter((s) => s && s !== ".");
  if (segments.includes("..")) return "";
  for (let i = segments.length; i > 0; i -= 1) {
    const prefix = segments.slice(0, i).join("/");
    if (PACKAGE_MARKERS.some((marker) => existsSync(path.join(projectDir, prefix, marker)))) return prefix;
  }
  return "";
}

/** The test files grouped by package, groups and files in order of first appearance. */
function groupByPackage(projectDir, files) {
  const groups = new Map();
  for (const file of files) {
    const prefix = packagePrefix(projectDir, file);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(file);
  }
  return [...groups].map(([prefix, repoFiles]) => ({
    dir: prefix ? path.join(projectDir, prefix) : projectDir,
    repoFiles,
    files: prefix ? repoFiles.map((file) => file.slice(prefix.length + 1)) : repoFiles,
  }));
}

/** detect() for one gate run: a package with no runner falls back to the root, detected once at most. */
function detectorFor(projectDir, detect) {
  let root;
  const detectRoot = () => {
    root ??= detect(projectDir);
    return root;
  };
  return async (dir) => (dir === projectDir ? detectRoot() : (await detect(dir)) ?? detectRoot());
}

async function runGroup(group, detectGroup, run) {
  const detected = await detectGroup(group.dir);
  const runner = runnerFor(detected ?? {}, group.files);
  if (!runner) return { group, skipped: detected?.framework || "this project" };
  const result = await run(runner.command, runner.args, { cwd: group.dir });
  return { group, runner, result };
}

const runnerNames = (outcomes) => [...new Set(outcomes.map((outcome) => outcome.runner.name))].join(", ");

function failure(reds) {
  const files = reds.flatMap((red) => red.group.repoFiles);
  const summary = `${files.length} test file(s) of the diff fail with ${runnerNames(reds)}: ${files.join(", ")}`;
  const description = [summary, ...reds.map((red) => outputTail(red.result))].join("\n");
  return { rejection: { verdict: "rejected", reviewer: "diff-tests", issues: [{ severity: "high", description }] }, note: null };
}

function successNote(outcomes) {
  const ran = outcomes.filter((outcome) => outcome.runner);
  const notes = [];
  if (ran.length > 0) {
    const count = ran.reduce((sum, outcome) => sum + outcome.group.files.length, 0);
    notes.push(`${count} test file(s) of the diff passed with ${runnerNames(ran)}`);
  }
  for (const { group, skipped } of outcomes.filter((outcome) => outcome.skipped)) {
    notes.push(`${group.files.length} test file(s) in the diff not run: no runner kj knows for ${skipped}`);
  }
  return notes.join("; ");
}

/** Runs the diff's test files from their own package: red rejects, green or unknown runner goes on with a note. */
export async function diffTestsGate({ projectDir, liveFiles, detect = detectTestFramework, run = runCommand }) {
  const files = diffTestFiles(liveFiles);
  if (files.length === 0) return { rejection: null, note: null };
  const detectGroup = detectorFor(projectDir, detect);
  const outcomes = [];
  for (const group of groupByPackage(projectDir, files)) outcomes.push(await runGroup(group, detectGroup, run));
  const reds = outcomes.filter((outcome) => outcome.runner && outcome.result.exitCode !== 0);
  if (reds.length > 0) return failure(reds);
  return { rejection: null, note: successNote(outcomes) };
}
