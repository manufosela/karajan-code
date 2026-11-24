// HU-4870 (KJC-TSK-1761): kj review --staged runs the diff's own test files before the reviewer;
// a red one ends the review in a rejection without calling the model.
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

function failure(files, runner, result) {
  const summary = `${files.length} test file(s) of the diff fail with ${runner.name}: ${files.join(", ")}`;
  const description = `${summary}\n${outputTail(result)}`;
  return { rejection: { verdict: "rejected", reviewer: "diff-tests", issues: [{ severity: "high", description }] }, note: null };
}

/** Runs the diff's test files with the project's runner: red rejects, green or unknown runner goes on with a note. */
export async function diffTestsGate({ projectDir, liveFiles, detect = detectTestFramework, run = runCommand }) {
  const files = diffTestFiles(liveFiles);
  if (files.length === 0) return { rejection: null, note: null };
  const detected = await detect(projectDir);
  const runner = runnerFor(detected ?? {}, files);
  if (!runner) {
    const what = detected?.framework || "this project";
    return { rejection: null, note: `${files.length} test file(s) in the diff not run: no runner kj knows for ${what}` };
  }
  const result = await run(runner.command, runner.args, { cwd: projectDir });
  if (result.exitCode !== 0) return failure(files, runner, result);
  return { rejection: null, note: `${files.length} test file(s) of the diff passed with ${runner.name}` };
}
