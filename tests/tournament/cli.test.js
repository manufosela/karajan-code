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

  it("fails actionably without a task", async () => {
    await expect(
      tournamentCommand({ task: "", config: {}, logger: logger(), flags: { coders: "a,b" }, runTournamentFn: async () => ({}) }),
    ).rejects.toThrow(/tarea|task/i);
  });
});
