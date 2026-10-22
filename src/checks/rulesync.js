/**
 * HU-0005 (ADR 0022, decision 6): the rulesync range kj was tested with, and
 * the doctor check that says when a project's rulesync falls outside it.
 * kj compiles its rules through rulesync (src/utils/rulesync.js), so a
 * version it never ran against is said, never assumed to work.
 */
import { runCommand } from "../utils/process.js";
import { detectRulesync, rulesyncCommand } from "../utils/rulesync.js";
import { STRATEGY } from "./types.js";

/** Tested with rulesync 16.14.0; any later 16.x release is accepted, 17 is not. */
export const RULESYNC_TESTED_RANGE = { min: "16.14.0", nextMajor: 17 };

const EXPECTED = `>=${RULESYNC_TESTED_RANGE.min} <${RULESYNC_TESTED_RANGE.nextMajor}`;
const FIX = `install rulesync@"${EXPECTED}" as a dev dependency`;
// A cold `npx --no-install` can exceed the runner's 5 s default.
const VERSION_TIMEOUT_MS = 10_000;
const VERSION_RE = /(\d+)\.(\d+)\.(\d+)(-\S+)?/;

const parse = (text) => {
  const m = VERSION_RE.exec(String(text));
  return m ? { parts: m.slice(1, 4).map(Number), prerelease: Boolean(m[4]), text: m[0] } : null;
};
const MIN = parse(RULESYNC_TESTED_RANGE.min).parts;

/** True for a release at least the tested minimum and below the next major; prereleases are untested. */
export function inTestedRange(version) {
  const v = parse(version);
  if (!v || v.prerelease || v.parts[0] >= RULESYNC_TESTED_RANGE.nextMajor) return false;
  const differing = v.parts.findIndex((part, i) => part !== MIN[i]);
  return differing === -1 || v.parts[differing] > MIN[differing];
}

async function readVersion(projectDir, run) {
  const [cmd, args] = rulesyncCommand(projectDir, ["--version"]);
  try {
    const res = await run(cmd, args, { cwd: projectDir, timeout: VERSION_TIMEOUT_MS });
    if (res.exitCode !== 0) return { error: res.stderr?.trim() || `exit code ${res.exitCode}` };
    const version = parse(res.stdout);
    return version ? { version: version.text } : { error: `unexpected output "${res.stdout.trim()}"` };
  } catch (err) {
    return { error: err.message };
  }
}

const warn = (detail) => ({ ok: false, severity: "warn", detail, fix: FIX });

function createRulesyncCheck({ projectDir, run }) {
  return {
    name: "rulesync",
    label: "Rulesync",
    strategy: STRATEGY.MANUAL,
    detectTimeoutMs: VERSION_TIMEOUT_MS + 5_000,
    async detect() {
      if (!detectRulesync(projectDir)) return { ok: true, severity: "info", detail: "not used in this project" };
      const { version, error } = await readVersion(projectDir, run);
      if (error) return warn(`the project uses rulesync but its version could not be read (${error}); tested range ${EXPECTED}`);
      if (!inTestedRange(version)) return warn(`rulesync ${version} is outside the range kj was tested with (${EXPECTED})`);
      return { ok: true, severity: "info", detail: `rulesync ${version} (tested range ${EXPECTED})` };
    },
  };
}

export function getRulesyncChecks({ projectDir = process.cwd(), run = runCommand } = {}) {
  return [createRulesyncCheck({ projectDir, run })];
}
