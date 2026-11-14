/**
 * KJC-BUG-0593: the contract commit kj makes carries the cross-AI verdict of its
 * exact diff, like any other commit, so `kj review --publish-pr` and verify-pr
 * accept it. Never fails the harden run: no reviewer means a printed command.
 */
import { execFileSync } from "node:child_process";

import { loadConfig } from "../config.js";

/** `kj review --range <sha>^..<sha>`, run from the project (the review reads git from the cwd). */
async function reviewRange({ projectDir, range }) {
  const { reviewGateCommand } = await import("../commands/review-gate.js");
  const { config } = await loadConfig(projectDir);
  const cwd = process.cwd();
  const exitCode = process.exitCode;
  process.chdir(projectDir);
  try {
    return await reviewGateCommand({ config: { ...config, projectDir }, flags: { range } });
  } finally {
    process.chdir(cwd);
    process.exitCode = exitCode; // a rejection here is reported by harden, not by the exit code
  }
}

const headSha = (projectDir) => execFileSync("git", ["-C", projectDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

/**
 * @param {{projectDir: string, say?: (line: string) => void, review?: Function, env?: object}} opts
 * @returns {Promise<{status: "approved"|"rejected"|"unavailable"|"skipped", command?: string}>}
 */
export async function reviewContractCommit({ projectDir, say = (line) => process.stdout.write(`${line}\n`), review = reviewRange, env = process.env }) {
  if (env.KJ_NO_CONTRACT_REVIEW === "1") return { status: "skipped" };
  const sha = headSha(projectDir);
  const range = `${sha}^..${sha}`;
  const command = `kj review --range ${sha.slice(0, 7)}^..${sha.slice(0, 7)}`;
  try {
    const record = await review({ projectDir, range });
    if (record?.verdict === "approved") {
      say(`kj harden: contract commit ${sha.slice(0, 7)} reviewed by ${record.reviewer}: approved`);
      return { status: "approved" };
    }
    const issues = (record?.issues ?? []).map((i) => `  - ${i.description ?? i.id}`).join("\n");
    say(`kj harden: the contract commit ${sha.slice(0, 7)} needs a fix before the PR (rejected by ${record?.reviewer ?? "the reviewer"}):\n${issues}`);
    return { status: "rejected" };
  } catch (err) {
    say(`kj harden: no reviewer reviewed the contract commit (${String(err.message).split("\n")[0]}). Run later: ${command}`);
    return { status: "unavailable", command };
  }
}
