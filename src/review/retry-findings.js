/**
 * HU-3533 (KJC-TSK-1445): what a retry of kj code learns from the review that rejected the staged
 * work, as kj run's loop handed the reviewer's findings to the next coder iteration. The verdict
 * is the one recorded for the exact staged diff; without a rejection of it there is nothing to
 * retry from, and kj says so instead of guessing.
 */
import { runCommand } from "../utils/process.js";
import { diffHash, loadVerdict } from "./verdict-store.js";
import { projectFileReader, splitFindings } from "./unanchored-findings.js";

const NO_REJECTION = "kj code --retry needs the review that rejected the staged work: stage it and run kj review --staged first";

const findingLine = (i) => {
  const where = i.line ? `${i.file}:${i.line}` : i.file;
  const fix = i.suggested_fix ? ` Fix: ${i.suggested_fix}` : "";
  const marked = i.unanchored ? ` (not anchored: ${i.unanchored})` : "";
  return `- [${i.severity}] ${where}: ${String(i.description).replace(/\.$/, "")}.${fix}${marked}`;
};

const unverifiedLine = (f) => `${findingLine(f)} (reason: ${f.reason})`;

/** HU-4843: what holds goes to the coder; a verdict saved before the split is anchored now. */
const anchoredSplit = (verdict, projectDir, diff) => {
  if (Array.isArray(verdict.unanchored)) return { blocking: verdict.issues ?? [], unanchored: verdict.unanchored };
  return splitFindings(verdict.issues, { diff, readFile: projectFileReader(projectDir) });
};

const unverifiedSection = (unanchored) => (unanchored.length === 0 ? [] : [
  "",
  "## Not verified",
  "These findings do not anchor to the code: do not fix them, they may not be there.",
  ...unanchored.map(unverifiedLine),
]);

/** The rejecting review of the staged diff as a section for the coder's task; throws when there is none. */
export async function rejectedReview({ projectDir, run = runCommand }) {
  // Raw git always (KJC-BUG-0115): the verdict is keyed by the exact staged diff.
  const res = await run("git", ["diff", "--cached"], { cwd: projectDir });
  if (res.exitCode !== 0) throw new Error(res.stderr?.trim() || "git diff --cached failed");
  const verdict = await loadVerdict(projectDir, diffHash(res.stdout));
  if (verdict?.verdict !== "rejected") throw new Error(NO_REJECTION);
  const { blocking, unanchored } = anchoredSplit(verdict, projectDir, res.stdout);
  const items = blocking.map(findingLine);
  const section = [
    "## The review rejected the previous attempt",
    `${verdict.reviewer} found these blocking issues in the staged work: fix them and keep the rest of it.`,
    ...items,
    ...unverifiedSection(unanchored),
  ].join("\n");
  return { reviewer: verdict.reviewer, count: items.length, findings: items, section };
}
