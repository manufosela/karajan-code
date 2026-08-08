// KJC-TSK-0725 TOR-C — the crown: the winner enters through the NORMAL
// door. In its still-alive lane: stage everything, cross-AI review of the
// EXACT staged diff (verdict bound to its sha256), commit through the real
// pre-commit gate — no escapes, no shortcuts. A rejected review aborts the
// coronation with the reasons; losers stay archived, never silently gone.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crownWinner } from "../../src/tournament/crown.js";

let dir, torDir, lanePath;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-crown-"));
  torDir = path.join(dir, ".kj", "tournaments", "tor-x");
  lanePath = path.join(dir, ".kj", "worktrees", "tor-x-claude");
  fs.mkdirSync(path.join(torDir, "claude"), { recursive: true });
  fs.mkdirSync(lanePath, { recursive: true });
  fs.writeFileSync(path.join(torDir, "judgement.json"), JSON.stringify({ winner: "claude", judge: "agy", escalated: false }));
  fs.writeFileSync(
    path.join(torDir, "claude", "meta.json"),
    JSON.stringify({ coder: "claude", branch: "tor/tor-x-claude", lane: lanePath }),
  );
  fs.writeFileSync(path.join(torDir, "summary.json"), JSON.stringify({ id: "tor-x", task: "build the thing", lanes: [] }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const okDeps = (calls) => ({
  execFn: async (cmd, args, { cwd }) => {
    calls.push({ cmd, args, cwd });
    if (cmd === "git" && args[0] === "rev-parse") return { exitCode: 0, stdout: "abc123def\n" };
    return { exitCode: 0, stdout: "" };
  },
  reviewFn: async ({ lane }) => {
    calls.push({ cmd: "review", cwd: lane });
    return { ok: true, verdict: "approved", reviewer: "codex", diffHash: "sha256sha256" };
  },
});

describe("crownWinner", () => {
  it("stages, reviews the staged diff, commits through the gate, and persists crown.json", async () => {
    const calls = [];
    const res = await crownWinner({
      tournamentDir: torDir,
      config: {},
      logger: { info: () => {}, warn: () => {} },
      deps: okDeps(calls),
    });
    expect(res.winner).toBe("claude");
    expect(res.branch).toBe("tor/tor-x-claude");
    expect(res.commit).toBe("abc123def");
    // order: add → review (BEFORE commit) → commit → rev-parse
    const seq = calls.map((c) => (c.cmd === "git" ? c.args[0] : c.cmd));
    expect(seq.indexOf("add")).toBeLessThan(seq.indexOf("review"));
    expect(seq.indexOf("review")).toBeLessThan(seq.indexOf("commit"));
    // every operation ran IN the winner's lane
    for (const c of calls) expect(c.cwd).toBe(lanePath);
    // the commit message is conventional and names the tournament
    const commitCall = calls.find((c) => c.cmd === "git" && c.args[0] === "commit");
    const msg = commitCall.args[commitCall.args.indexOf("-m") + 1];
    expect(msg).toMatch(/^feat\(tournament\):/);
    expect(msg).toContain("tor-x");
    const saved = JSON.parse(fs.readFileSync(path.join(torDir, "crown.json"), "utf8"));
    expect(saved.commit).toBe("abc123def");
    expect(saved.verdict.reviewer).toBe("codex");
  });

  it("appends the user's card ref to the commit message when provided (card-first gates)", async () => {
    const calls = [];
    await crownWinner({ tournamentDir: torDir, config: {}, logger: { info: () => {} }, deps: okDeps(calls), cardRef: "KJC-TSK-0999" });
    const commitCall = calls.find((c) => c.cmd === "git" && c.args[0] === "commit");
    expect(commitCall.args[commitCall.args.indexOf("-m") + 1]).toContain("KJC-TSK-0999");
  });

  it("a rejected review ABORTS the coronation — no commit, reasons surfaced", async () => {
    const calls = [];
    const deps = okDeps(calls);
    deps.reviewFn = async () => ({ ok: false, verdict: "rejected", issues: [{ description: "smells" }] });
    await expect(
      crownWinner({ tournamentDir: torDir, config: {}, logger: { info: () => {}, warn: () => {} }, deps }),
    ).rejects.toThrow(/rejected|rechaz/i);
    expect(calls.some((c) => c.cmd === "git" && c.args[0] === "commit")).toBe(false);
  });

  it("a gone lane is an actionable error — crown right after judging, before cleaning lanes", async () => {
    fs.rmSync(lanePath, { recursive: true, force: true });
    await expect(
      crownWinner({ tournamentDir: torDir, config: {}, logger: { info: () => {} }, deps: okDeps([]) }),
    ).rejects.toThrow(/lane|carril/i);
  });

  it("missing judgement points to --judge first", async () => {
    fs.rmSync(path.join(torDir, "judgement.json"));
    await expect(
      crownWinner({ tournamentDir: torDir, config: {}, logger: { info: () => {} }, deps: okDeps([]) }),
    ).rejects.toThrow(/--judge|judgement/i);
  });
});
