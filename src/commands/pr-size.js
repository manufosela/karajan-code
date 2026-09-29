/**
 * KJC-TSK-0910 — `kj pr-size`: the branch's size while it is being written,
 * with the SAME budget the CI gate applies (loc-budget.js). It counts what is
 * committed, what is not yet, and new files not yet added, against the merge
 * base with the base branch, so the Sentinel can warn before the gate blocks.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { budgetedAdded } from "../review/loc-budget.js";

const git = (projectDir, args) =>
  execFileSync("git", ["-C", projectDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function mergeBase(projectDir, base) {
  for (const ref of [`origin/${base}`, base]) {
    try { return git(projectDir, ["merge-base", "HEAD", ref]).trim(); } catch { /* try the next ref */ }
  }
  throw new Error(`pr-size: no merge base with ${base} (nor origin/${base})`);
}

/** @returns {Promise<{added: number, exempt: number, testAdded: number, base: string}>} */
export async function branchSize({ projectDir = process.cwd(), base = "main" } = {}) {
  const from = mergeBase(projectDir, base);
  // Working tree against the merge base: committed and uncommitted together.
  let numstat = git(projectDir, ["diff", "--numstat", from]);
  // New files not yet added are where a branch grows while it is written.
  for (const file of git(projectDir, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)) {
    let text;
    try { text = readFileSync(join(projectDir, file), "utf8"); } catch { continue; }
    if (text.includes("\0")) continue; // binary
    // Lines as git counts them: an empty file adds none.
    const n = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    numstat += `${n}\t0\t${file}\n`;
  }
  return { ...budgetedAdded(numstat), base };
}

export async function prSizeCommand({ config, logger = console, flags = {} }) {
  const s = await branchSize({ projectDir: config?.projectDir || process.cwd(), base: config?.base_branch || "main" });
  if (flags.json) process.stdout.write(`${JSON.stringify(s)}\n`);
  else logger.info(`pr-size: ${s.added} line(s) added against ${s.base} (${s.testAdded} in tests, ${s.exempt} exempt)`);
  return s;
}
