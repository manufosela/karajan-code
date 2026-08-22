/**
 * KJC-BUG-0146 — when a reviewer answers something the parser cannot read.
 *
 * Until now that answer was thrown away: the error said "no parseable verdict"
 * and not one byte of what the reviewer actually replied survived. Eight
 * occurrences produced zero evidence, which is why the bug stayed undiagnosed
 * for two days. A failure nobody can inspect is a failure nobody can fix.
 *
 * So the raw answer is written next to the verdicts and an excerpt travels in
 * the error. Nothing else changes: an unreadable answer is still a refusal,
 * never a pass — it COULD be a rejection in the wrong shape, and switching to
 * another reviewer would turn it into an approval.
 */
import fs from "node:fs/promises";
import path from "node:path";

const DIR = path.join(".karajan", "reviews");
const EXCERPT = 400;

/** One line about what came back, so the shape is visible without opening anything. */
export function describeOutput(output) {
  if (output === undefined || output === null) return "no output at all";
  if (typeof output !== "string") return `${typeof output}, not a string`;
  if (output.trim() === "") return "empty output";
  return `${output.length} chars, starts with ${JSON.stringify(output.slice(0, 60))}`;
}

/**
 * Writes the raw answer for inspection and returns the error message to raise.
 * A failure to write is never allowed to hide the original problem.
 * @param {{projectDir?: string, reviewer: string, output: unknown, hash: string, writeFile?: Function}} args
 */
export async function reportUnparseableVerdict({ projectDir = process.cwd(), reviewer, output, hash, writeFile = fs.writeFile }) {
  const file = path.join(projectDir, DIR, `${hash}.unparseable.txt`);
  const body = typeof output === "string" ? output : JSON.stringify(output ?? null, null, 2);
  let saved = null;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `reviewer: ${reviewer}\n\n${body}\n`, "utf8");
    saved = file;
  } catch {
    // Could not save it — the excerpt below still travels, and the message says so.
  }
  const excerpt = typeof output === "string" && output.trim() ? `\n--- what ${reviewer} answered (first ${EXCERPT} chars) ---\n${output.slice(0, EXCERPT)}\n---` : "";
  return [
    `reviewer ${reviewer} returned no parseable verdict (${describeOutput(output)})`,
    saved ? `full answer saved to ${path.relative(projectDir, saved)}` : "the full answer could NOT be saved to disk",
    "an unreadable answer is a refusal, not a pass: it may be a rejection in the wrong shape (KJC-BUG-0146)",
  ].join("\n") + excerpt;
}
