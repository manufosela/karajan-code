// KJC-TSK-1417: what the Planning Game asks for to finish a card (the commits and the merged PR that
// name it), read from the project's own git and gh, with no shell.
import { describe, expect, it } from "vitest";
import { gitEvidence } from "../src/evidence.js";

const SEP = "\u001f";
const runOf = (answers) => {
  const calls = [];
  const run = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    return answers[cmd] ?? { exitCode: 0, stdout: "" };
  };
  return { run, calls };
};

describe("gitEvidence", () => {
  it("reads the commits of the main branch and the merged PR that name the card", async () => {
    const { run, calls } = runOf({
      git: { exitCode: 0, stdout: `abc1234${SEP}feat: x (KJC-TSK-0001)${SEP}2026-11-05T09:00:00+01:00${SEP}manufosela\n` },
      gh: { exitCode: 0, stdout: JSON.stringify([{ number: 7, url: "https://github.com/acme/app/pull/7", mergedAt: "2026-11-05T08:30:00Z" }]) },
    });
    const evidence = gitEvidence({ run, projectDir: "/repo" });
    expect(await evidence("KJC-TSK-0001")).toEqual({
      commits: [{ hash: "abc1234", message: "feat: x (KJC-TSK-0001)", date: "2026-11-05T09:00:00+01:00", author: "manufosela" }],
      pr: { prUrl: "https://github.com/acme/app/pull/7", prNumber: 7, date: "2026-11-05T08:30:00Z" },
    });
    expect(calls[0]).toMatchObject({ cmd: "git", cwd: "/repo", args: expect.arrayContaining(["log", "origin/main", "--no-merges", "--grep=KJC-TSK-0001"]) });
    expect(calls[1]).toMatchObject({ cmd: "gh", cwd: "/repo", args: expect.arrayContaining(["pr", "list", "--state", "merged", "--search", "KJC-TSK-0001 in:title"]) });
  });

  it("no commit and no PR are an empty answer; a git or gh that fails is said, never read as nothing", async () => {
    expect(await gitEvidence({ run: runOf({ gh: { exitCode: 0, stdout: "[]" } }).run, projectDir: "/repo" })("KJC-TSK-0002")).toEqual({ commits: [], pr: null });
    const broken = gitEvidence({ run: runOf({ git: { exitCode: 128, stdout: "", stderr: "fatal: bad revision" } }).run, projectDir: "/repo" });
    await expect(broken("KJC-TSK-0003")).rejects.toMatchObject({ name: "BoardRejectedError", message: expect.stringMatching(/git log.*bad revision/) });
  });

  it("refuses an id that is not a card id before running anything", async () => {
    const { run, calls } = runOf({});
    await expect(gitEvidence({ run, projectDir: "/repo" })("KJC; rm -rf /")).rejects.toMatchObject({ name: "BoardRejectedError" });
    expect(calls).toHaveLength(0);
  });
});
