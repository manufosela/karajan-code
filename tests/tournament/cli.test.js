// KJC-TSK-0723 TOR-A PR2 — `kj tournament` command wiring: csv parsing,
// actionable errors, and the human summary with next steps.
import { describe, it, expect } from "vitest";
import { tournamentCommand } from "../../src/commands/tournament.js";

const logger = () => {
  const lines = [];
  return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
};

describe("tournamentCommand", () => {
  it("parses --coders csv, trims entries, and passes everything to the runner", async () => {
    let seen = null;
    const log = logger();
    const res = await tournamentCommand({
      task: "build it",
      config: { projectDir: "/p" },
      logger: log,
      flags: { coders: " claude , codex " },
      runTournamentFn: async (args) => {
        seen = args;
        return { id: "tor-x", dir: "/p/.kj/tournaments/tor-x", lanes: [{ coder: "claude", status: "completed", suite: { ok: true } }] };
      },
    });
    expect(seen.coders).toEqual(["claude", "codex"]);
    expect(seen.task).toBe("build it");
    expect(res.id).toBe("tor-x");
    expect(log.lines.join("\n")).toMatch(/tor-x/);
    expect(log.lines.join("\n")).toMatch(/scoreboard|TOR-B/i);
  });

  it("fails actionably without --coders, and with fewer than two coders (the command enforces its own contract)", async () => {
    await expect(
      tournamentCommand({ task: "t", config: {}, logger: logger(), flags: {}, runTournamentFn: async () => ({}) }),
    ).rejects.toThrow(/--coders/);
    await expect(
      tournamentCommand({ task: "t", config: {}, logger: logger(), flags: { coders: "claude" }, runTournamentFn: async () => ({}) }),
    ).rejects.toThrow(/2/);
  });

  it("--score <id> scores an existing tournament and prints rule, ranking and per-lane rows", async () => {
    const log = logger();
    const res = await tournamentCommand({
      task: "",
      config: { projectDir: "/p" },
      logger: log,
      flags: { score: "tor-x", json: false },
      scoreTournamentFn: async ({ tournamentDir }) => {
        expect(tournamentDir).toBe("/p/.kj/tournaments/tor-x");
        return {
          id: "tor-x",
          rule: "finalistas = suite verde; orden: LOC neto asc",
          ranking: ["claude"],
          rows: [
            { coder: "claude", finalist: true, suite: { ok: true }, loc: { net: 8, testsTouched: 1 }, mutation: { score: null, note: "not available" }, sonar: null },
            { coder: "codex", finalist: false, eliminated_by: "suite" },
          ],
        };
      },
    });
    expect(res.ranking).toEqual(["claude"]);
    const out = log.lines.join("\n");
    expect(out).toMatch(/regla|rule/i);
    expect(out).toMatch(/claude/);
    expect(out).toMatch(/eliminado|eliminated/i);
  });

  it("--score rejects ids that could traverse paths", async () => {
    for (const evil of ["../../..", "a/b", ".oculto"]) {
      await expect(
        tournamentCommand({ task: "", config: {}, logger: logger(), flags: { score: evil }, scoreTournamentFn: async () => ({}) }),
      ).rejects.toThrow(/inválido|invalid/i);
    }
  });

  it("--score --json emits the stable board as JSON on the logger", async () => {
    const log = logger();
    await tournamentCommand({
      task: "", config: { projectDir: "/p" }, logger: log,
      flags: { score: "tor-x", json: true },
      scoreTournamentFn: async () => ({ id: "tor-x", rule: "r", ranking: [], rows: [] }),
    });
    expect(() => JSON.parse(log.lines.at(-1))).not.toThrow();
  });

  it("fails actionably without a task", async () => {
    await expect(
      tournamentCommand({ task: "", config: {}, logger: logger(), flags: { coders: "a,b" }, runTournamentFn: async () => ({}) }),
    ).rejects.toThrow(/tarea|task/i);
  });
});
