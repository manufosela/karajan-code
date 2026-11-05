// KJC-TSK-1417: the commits and the merged PR that name a card, which the Planning Game asks for to
// finish it (To Validate). Read from the project's git (its main branch) and gh, as argument arrays.
import { BoardRejectedError } from "./board-errors.js";

const SEP = "\u001f";
const CARD_ID = /^[A-Z][A-Z0-9]*-[A-Z]+-\d+$/;

/** @param {{run: (cmd: string, args: string[], opts: {cwd: string}) => Promise<{exitCode: number, stdout: string, stderr?: string}>, projectDir: string, branch?: string}} opts */
export function gitEvidence({ run, projectDir, branch = "origin/main" }) {
  const exec = async (cmd, args) => {
    const res = await run(cmd, args, { cwd: projectDir });
    if (res.exitCode !== 0) throw new BoardRejectedError(`${cmd} ${args.slice(0, 2).join(" ")} failed: ${(res.stderr || res.stdout || "").trim()}`);
    return res.stdout;
  };
  return async (cardId) => {
    if (!CARD_ID.test(String(cardId))) throw new BoardRejectedError(`"${cardId}" is not a card id`);
    // --no-merges: a PR's merge commit names the card in its message but is not work on it.
    const log = await exec("git", ["log", branch, "--no-merges", `--grep=${cardId}`, "--fixed-strings", `--format=%H${SEP}%s${SEP}%aI${SEP}%an`]);
    const commits = log.split("\n").filter(Boolean).map((line) => {
      const [hash, message, date, author] = line.split(SEP);
      return { hash, message, date, author };
    });
    const pulls = JSON.parse((await exec("gh", ["pr", "list", "--state", "merged", "--search", `${cardId} in:title`, "--json", "number,url,mergedAt", "--limit", "1"])) || "[]");
    const pr = pulls[0] ? { prUrl: pulls[0].url, prNumber: pulls[0].number, date: pulls[0].mergedAt } : null;
    return { commits, pr };
  };
}
