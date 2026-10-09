/**
 * KJC-TSK-1000 (HUM-B3, ADR 0018): CI judges every change of the roster of
 * signing phones. When the diff touches .karajan/supervisor-signers.json, the
 * roster of the base (the range's start, or HEAD for a staged check) and the
 * one that lands (the checkout, or the staged blob) go through
 * `verifyRosterChange`; a refusal is a deny violation with its reason, so that
 * reinstalling kj on a machine never changes what CI demands.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SIGNERS_FILE, verifyRosterChange } from "../harden/roster.js";

export const ROSTER_RULE = "defaults.roster.change";

const parse = (text) => { try { return JSON.parse(text); } catch { return {}; } };
// An object that is not a roster reads as an empty one: a base that is missing is
// a first roster; a landing one that is missing or broken loses every key.
const shown = async (run, spec) => { try { return parse(await run(["show", spec])); } catch { return null; } };
const local = (projectDir) => { try { return parse(readFileSync(join(projectDir, SIGNERS_FILE), "utf8")); } catch { return null; } };

/**
 * @param {{projectDir: string, files: string[], range: string|null, run: (args: string[]) => Promise<string>}} opts
 * @returns {Promise<object|null>} the violation, or null when the roster is untouched or the change is backed
 */
export async function rosterViolation({ projectDir, files, range, run }) {
  if (!files.includes(SIGNERS_FILE)) return null;
  const baseRef = range ? range.split(/\.{2,3}/)[0] : "HEAD";
  const before = await shown(run, `${baseRef}:${SIGNERS_FILE}`);
  const after = range ? local(projectDir) : await shown(run, `:${SIGNERS_FILE}`);
  const verdict = verifyRosterChange({ before, after });
  if (verdict.ok) return null;
  return { rule_id: ROSTER_RULE, enforcement: "deny", file: SIGNERS_FILE, reason: `el padrón de móviles cambia sin respaldo (ADR 0018): ${verdict.reason}` };
}
