/**
 * KJC-BUG-0593: the contract commit kj makes carries the cross-AI verdict of its
 * exact diff, like any other commit, so `kj review --publish-pr` and verify-pr
 * accept it. Never fails the harden run: no reviewer means a printed command.
 */
import { loadConfig } from "../config.js";

/** `kj review --staged`, run from the project (the review reads git from the cwd). */
async function reviewStaged({ projectDir }) {
  const { reviewGateCommand } = await import("../commands/review-gate.js");
  const { config } = await loadConfig(projectDir);
  const cwd = process.cwd();
  const exitCode = process.exitCode;
  process.chdir(projectDir);
  try {
    return await reviewGateCommand({ config: { ...config, projectDir }, flags: { staged: true } });
  } finally {
    process.chdir(cwd);
    process.exitCode = exitCode; // a rejection here is reported by harden, not by the exit code
  }
}

/** HU-4361: the review runs git from this process, so while it runs GIT_INDEX_FILE names the index it reads. */
async function withIndexFile(indexFile, run) {
  if (!indexFile) return run();
  const previous = process.env.GIT_INDEX_FILE;
  process.env.GIT_INDEX_FILE = indexFile;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = previous;
  }
}

/**
 * HU-4361: reviews the contract diff BEFORE the commit, so the verdict is there
 * when the pre-commit gate looks for it. `indexFile`: the index that holds the
 * contract alone, which the review reads in place of the person's own.
 * @param {{projectDir: string, indexFile?: string, say?: (line: string) => void, review?: Function, env?: object}} opts
 * @returns {Promise<{status: "approved"|"rejected"|"unavailable"|"skipped"}>}
 */
export async function reviewContractCommit({ projectDir, indexFile, say = (line) => process.stdout.write(`${line}\n`), review = reviewStaged, env = process.env }) {
  if (env.KJ_NO_CONTRACT_REVIEW === "1") return { status: "skipped" };
  try {
    const record = await withIndexFile(indexFile, () => review({ projectDir }));
    if (record?.verdict === "approved") {
      say(`kj harden: the contract reviewed by ${record.reviewer}: approved`);
      return { status: "approved" };
    }
    const issues = (record?.issues ?? []).map((i) => `  - ${i.description ?? i.id}`).join("\n");
    say(`kj harden: the contract needs a fix before it is committed (rejected by ${record?.reviewer ?? "the reviewer"}):\n${issues}`);
    return { status: "rejected" };
  } catch (err) {
    say(`kj harden: no reviewer reviewed the contract (${String(err.message).split("\n")[0]})`);
    return { status: "unavailable" };
  }
}
