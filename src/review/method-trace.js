// KJC-TSK-1523: kj review leaves one line per check of TDD (tests with the code), the Steward
// and Sonar in the lane's .karajan/traces/method.jsonl (writable under the sandbox, KJC-BUG-0527),
// so kj stage shows each piece at work. Only the piece and whether it passed: never findings.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const METHOD_FILE = ".karajan/traces/method.jsonl";
const PIECES = new Set(["tdd", "steward", "sonar"]);

/** Appends `{ at, piece, outcome }`; only in a kj project, and losing it never stops the review. */
export function traceMethod(projectDir, { piece, passed }) {
  if (!PIECES.has(piece) || !existsSync(join(projectDir, ".karajan"))) return;
  const line = { at: new Date().toISOString(), piece, outcome: passed ? "pass" : "refuse" };
  try {
    mkdirSync(join(projectDir, ".karajan", "traces"), { recursive: true });
    appendFileSync(join(projectDir, METHOD_FILE), `${JSON.stringify(line)}\n`);
  } catch {
    // The trace is for the stage only: the review's verdict does not depend on it.
  }
}
