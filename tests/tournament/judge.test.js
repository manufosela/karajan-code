// KJC-TSK-0725 TOR-C — the judge: a cross-AI reviewer that RANKS the
// finalists with the scoreboard in sight. The deterministic phase (TOR-B)
// eliminates; the judge chooses among survivors. Conflict-of-interest rule:
// a participant coder can never judge its own tournament, and neither can
// the host. Disagreement with the scoreboard, or a declared tie, escalates
// to solomon WITH both positions. Full DI.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { judgeTournament, pickJudge } from "../../src/tournament/judge.js";

let dir, torDir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-torc-"));
  torDir = path.join(dir, ".kj", "tournaments", "tor-x");
  fs.mkdirSync(torDir, { recursive: true });
  for (const coder of ["claude", "codex"]) {
    fs.mkdirSync(path.join(torDir, coder), { recursive: true });
    fs.writeFileSync(path.join(torDir, coder, "diff.patch"), `diff for ${coder}\n+x\n`);
  }
  fs.writeFileSync(
    path.join(torDir, "scoreboard.json"),
    JSON.stringify({
      id: "tor-x", task: "build it",
      rule: "finalistas = suite verde; orden: LOC neto asc",
      ranking: ["claude", "codex"],
      rows: [
        { coder: "claude", finalist: true, loc: { net: 8, testsTouched: 1 }, mutation: { score: null } },
        { coder: "codex", finalist: true, loc: { net: 12, testsTouched: 1 }, mutation: { score: null } },
      ],
    }),
  );
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const judgeReply = (ranking, tie = false) => ({
  ok: true,
  output: JSON.stringify({ ranking, reasons: { [ranking[0]]: "cleaner" }, tie }),
});

describe("pickJudge — no conflict of interest", () => {
  const statuses = [
    { name: "codex", installed: true, authenticated: true },
    { name: "copilot", installed: true, authenticated: true },
    { name: "agy", installed: true, authenticated: true },
  ];
  it("keeps the configured reviewer when it did not compete and is not the host", () => {
    expect(pickJudge({ configured: "agy", participants: ["claude", "codex"], host: "claude", statuses })).toBe("agy");
  });
  it("a participant can never judge its own tournament — next clean candidate wins", () => {
    expect(pickJudge({ configured: "codex", participants: ["claude", "codex"], host: "claude", statuses })).toBe("copilot");
  });
  it("returns null when every candidate competed or is the host", () => {
    expect(pickJudge({ configured: "codex", participants: ["claude", "codex", "copilot", "agy"], host: "claude", statuses })).toBeNull();
  });
});

describe("judgeTournament", () => {
  const base = (agentReply, extra = {}) => ({
    tournamentDir: torDir,
    config: {},
    logger: { info: () => {}, warn: () => {} },
    deps: {
      judgeFn: async () => "agy",
      agentFn: async ({ prompt }) => {
        base.lastPrompt = prompt;
        return agentReply;
      },
      solomonFn: async (args) => {
        base.solomonArgs = args;
        return { winner: "codex", reason: "solomon ruled" };
      },
      ...extra,
    },
  });

  it("agreement: judge top matches scoreboard top — winner declared, judgement.json persisted with reasons", async () => {
    const args = base(judgeReply(["claude", "codex"]));
    const res = await judgeTournament(args);
    expect(res.winner).toBe("claude");
    expect(res.escalated).toBe(false);
    expect(base.lastPrompt).toMatch(/scoreboard|regla/i);
    expect(base.lastPrompt).toContain("diff for claude");
    const saved = JSON.parse(fs.readFileSync(path.join(torDir, "judgement.json"), "utf8"));
    expect(saved.winner).toBe("claude");
    expect(saved.judge).toBe("agy");
  });

  it("disagreement with the scoreboard escalates to solomon WITH both positions", async () => {
    const args = base(judgeReply(["codex", "claude"]));
    const res = await judgeTournament(args);
    expect(res.escalated).toBe(true);
    expect(res.winner).toBe("codex");
    expect(base.solomonArgs.judgeRanking).toEqual(["codex", "claude"]);
    expect(base.solomonArgs.boardRanking).toEqual(["claude", "codex"]);
  });

  it("a declared tie escalates to solomon", async () => {
    const args = base(judgeReply(["claude", "codex"], true));
    const res = await judgeTournament(args);
    expect(res.escalated).toBe(true);
  });

  it("fewer than two finalists needs no judge — the only finalist wins by walkover", async () => {
    const board = JSON.parse(fs.readFileSync(path.join(torDir, "scoreboard.json"), "utf8"));
    board.rows[1].finalist = false;
    board.ranking = ["claude"];
    fs.writeFileSync(path.join(torDir, "scoreboard.json"), JSON.stringify(board));
    const args = base(judgeReply(["claude"]));
    const res = await judgeTournament(args);
    expect(res.winner).toBe("claude");
    expect(res.walkover).toBe(true);
  });

  it("a hallucinated ranking (non-finalist names, empty, garbage) fails loud — never crowned", async () => {
    for (const bad of [judgeReply(["gemini-imaginario"]), judgeReply([]), { ok: true, output: "not json at all" }]) {
      await expect(judgeTournament(base(bad))).rejects.toThrow(/inválido|parseable/i);
    }
  });

  it("a solomon winner outside the finalists fails loud too", async () => {
    const args = base(judgeReply(["codex", "claude"]));
    args.deps.solomonFn = async () => ({ winner: "intruso" });
    await expect(judgeTournament(args)).rejects.toThrow(/solomon.*inválido/i);
  });

  it("no clean judge available is an actionable error, never a participant judging itself", async () => {
    const args = base(judgeReply(["claude"]), { judgeFn: async () => null });
    await expect(judgeTournament(args)).rejects.toThrow(/juez|judge/i);
  });
});
