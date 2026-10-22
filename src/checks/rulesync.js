/**
 * HU-0005 (ADR 0022, decision 6): the rulesync range kj was tested with, and
 * the doctor check that says when a project's rulesync falls outside it.
 * kj compiles its rules through rulesync (src/utils/rulesync.js), so a
 * version it never ran against is said, never assumed to work.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../utils/process.js";
import { detectRulesync } from "../utils/rulesync.js";
import { STRATEGY } from "./types.js";

/** Tested with rulesync 16.14.0; any later 16.x is accepted, 17 is not. */
export const RULESYNC_TESTED_RANGE = { min: "16.14.0", nextMajor: 17 };

const rangeLabel = ({ min, nextMajor }) => `>=${min} <${nextMajor}`;
const parse = (v) => /(\d+)\.(\d+)\.(\d+)/.exec(String(v))?.slice(1).map(Number) ?? null;

/** True when `version` is at least the tested minimum and below the next major. */
export function inTestedRange(version, range = RULESYNC_TESTED_RANGE) {
  const v = parse(version);
  if (!v) return false;
  if (v[0] >= range.nextMajor) return false;
  const min = parse(range.min);
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
}

// The project's own binary, or npx without installing: the same rule as
// maybeRulesyncGenerate — kj never runs a package fetched on the fly.
async function installedVersion(projectDir, run) {
  const local = join(projectDir, "node_modules", ".bin", "rulesync");
  const [cmd, args] = existsSync(local) ? [local, ["--version"]] : ["npx", ["--no-install", "rulesync", "--version"]];
  try {
    const res = await run(cmd, args, { cwd: projectDir });
    return res.exitCode === 0 ? parse(res.stdout)?.join(".") ?? null : null;
  } catch {
    return null;
  }
}

function createRulesyncCheck({ projectDir, run }) {
  const expected = rangeLabel(RULESYNC_TESTED_RANGE);
  return {
    name: "rulesync",
    label: "Rulesync",
    strategy: STRATEGY.MANUAL,
    async detect() {
      if (!detectRulesync(projectDir)) {
        return { ok: true, severity: "info", detail: "not used in this project" };
      }
      const version = await installedVersion(projectDir, run);
      if (!version) {
        return {
          ok: false,
          severity: "warn",
          detail: `the project uses rulesync but no rulesync binary runs here (tested range ${expected})`,
          fix: `npm i -D rulesync@"${expected}"`,
        };
      }
      if (!inTestedRange(version)) {
        return {
          ok: false,
          severity: "warn",
          detail: `rulesync ${version} is outside the range kj was tested with (${expected})`,
          fix: `npm i -D rulesync@"${expected}"`,
        };
      }
      return { ok: true, severity: "info", detail: `rulesync ${version} (tested range ${expected})` };
    },
  };
}

export function getRulesyncChecks({ projectDir = process.cwd(), run = runCommand } = {}) {
  return [createRulesyncCheck({ projectDir, run })];
}
