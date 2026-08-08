// KJC-TSK-0723 TOR-A — the tournament fan-out: the SAME task to N coders in
// N isolated worktree lanes, results collected per lane, one lane's failure
// never sinking the others. Orca's "fan out and compare" — but the compare
// will be the method's (TOR-B/C), not vibes. Full DI: no real git, agents
// or package managers in these tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTournament } from "../../src/tournament/run.js";

let projectDir;
beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-tor-"));
});
afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

const okAgent = (marks) => (name, laneConfig) => ({
  runTask: async (task) => {
    marks.push({ name, cwd: task.cwd, projectDir: laneConfig.projectDir, role: task.role });
    return { ok: true, output: `${name} did the work` };
  },
});

const baseDeps = (marks, overrides = {}) => ({
  createAgentFn: okAgent(marks),
  gitFn: async (args, cwd) => {
    marks.push({ git: args[0], cwd });
    if (args[0] === "diff") return { stdout: `diff --git a/x.js b/x.js\n+by lane ${cwd}\n` };
    return { stdout: "" };
  },
  bootstrapFn: async () => ({ ok: true }),
  runSuiteFn: async () => ({ ok: true, exitCode: 0, output: "633 passed" }),
  ...overrides,
});

describe("runTournament fan-out", () => {
  it("creates one isolated lane per coder, runs each agent with the lane as cwd, and collects results", async () => {
    const marks = [];
    const res = await runTournament({
      task: "build the rate limiter",
      coders: ["claude", "codex"],
      config: { projectDir },
      logger: { info: () => {}, warn: () => {} },
      deps: baseDeps(marks),
    });

    expect(res.lanes).toHaveLength(2);
    for (const lane of res.lanes) {
      expect(lane.status).toBe("completed");
      expect(lane.suite.ok).toBe(true);
      expect(fs.readFileSync(path.join(lane.dir, "diff.patch"), "utf8")).toContain("by lane");
      const meta = JSON.parse(fs.readFileSync(path.join(lane.dir, "meta.json"), "utf8"));
      expect(meta.coder).toBe(lane.coder);
      expect(meta.branch).toMatch(/^tor\//);
    }
    // each agent ran with ITS lane as cwd and laneConfig.projectDir
    const agentMarks = marks.filter((m) => m.name);
    expect(agentMarks).toHaveLength(2);
    for (const m of agentMarks) {
      expect(m.cwd).toContain(".kj/worktrees/");
      expect(m.projectDir).toBe(m.cwd);
      expect(m.role).toBe("coder");
    }
    // two distinct lanes
    expect(new Set(agentMarks.map((m) => m.cwd)).size).toBe(2);
    // untracked files enter the evidence: intent-to-add precedes every diff
    const gitOps = marks.filter((m) => m.git).map((m) => m.git);
    expect(gitOps.filter((g) => g === "add")).toHaveLength(2);
    expect(gitOps.indexOf("add")).toBeLessThan(gitOps.indexOf("diff"));
  });

  it("a failing lane reports status failed with its cause and does not sink the others", async () => {
    const marks = [];
    const deps = baseDeps(marks, {
      createAgentFn: (name, laneConfig) =>
        name === "codex"
          ? { runTask: async () => { throw new Error("codex exploded"); } }
          : okAgent(marks)(name, laneConfig),
    });
    const res = await runTournament({
      task: "t", coders: ["claude", "codex"], config: { projectDir },
      logger: { info: () => {}, warn: () => {} }, deps,
    });
    const failed = res.lanes.find((l) => l.coder === "codex");
    const alive = res.lanes.find((l) => l.coder === "claude");
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("codex exploded");
    expect(alive.status).toBe("completed");
  });

  it("a red suite is a completed lane with suite.ok false — elimination is TOR-B's job, not an error", async () => {
    const marks = [];
    const deps = baseDeps(marks, { runSuiteFn: async () => ({ ok: false, exitCode: 1, output: "2 failed" }) });
    const res = await runTournament({
      task: "t", coders: ["claude", "codex"], config: { projectDir },
      logger: { info: () => {}, warn: () => {} }, deps,
    });
    for (const lane of res.lanes) {
      expect(lane.status).toBe("completed");
      expect(lane.suite.ok).toBe(false);
    }
  });

  it("rejects coder names that could traverse paths — lanes and results derive dirs from them", async () => {
    for (const evil of ["../evil", "a/b", ".hidden", "x".repeat(40)]) {
      await expect(
        runTournament({ task: "t", coders: [evil, "claude"], config: { projectDir }, logger: {}, deps: baseDeps([]) }),
      ).rejects.toThrow(/inválido|invalid/i);
    }
  });

  it("rejects fewer than two coders — one coder is not a tournament", async () => {
    await expect(
      runTournament({ task: "t", coders: ["claude"], config: { projectDir }, logger: {}, deps: baseDeps([]) }),
    ).rejects.toThrow(/2|dos/);
  });
});
