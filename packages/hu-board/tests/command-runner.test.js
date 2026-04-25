import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import request from "supertest";

let tmpHome;
let app;
let dbMod;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "hu-board-cmd-"));
  process.env.KJ_HOME = tmpHome;
  // Echo mode short-circuits the actual `kj` spawn so the test doesn't
  // boot the orchestrator.
  process.env.KJ_RUN_SPAWN_MODE = "echo";

  dbMod = await import("../src/db.js");
  dbMod.initDb();
  const { default: apiRoutes } = await import("../src/routes/api.js");
  app = express();
  app.use(express.json());
  app.use("/api", apiRoutes);
});

afterEach(() => {
  delete process.env.KJ_RUN_SPAWN_MODE;
  dbMod.closeDb();
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

describe("GET /api/commands", () => {
  it("lists the supported kj commands the board can launch", async () => {
    const res = await request(app).get("/api/commands");
    expect(res.status).toBe(200);
    expect(res.body.commands).toEqual(expect.arrayContaining(["plan", "architect", "clean"]));
  });
});

describe("POST /api/commands/:command", () => {
  it("rejects an unknown command name with 400", async () => {
    const res = await request(app).post("/api/commands/sudo").send({ task: "rm -rf /" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported command/);
  });

  it("plan: builds argv with the positional task when no taskFile is given", async () => {
    const { runKjCommand } = await import("../src/command-runner.js");
    const result = runKjCommand({ command: "plan", input: { task: "build login" } });
    expect(result.ok).toBe(true);
    expect(result.argv.some((a) => a === "build login")).toBe(true);
    expect(result.argv).toContain("plan");
  });

  it("plan: passes --task-file when provided AND drops the positional task", async () => {
    const { runKjCommand } = await import("../src/command-runner.js");
    const result = runKjCommand({ command: "plan", input: { taskFile: "/tmp/SPEC.md", task: "ignored" } });
    expect(result.ok).toBe(true);
    const idx = result.argv.indexOf("--task-file");
    expect(idx).toBeGreaterThan(-1);
    expect(result.argv[idx + 1]).toBe("/tmp/SPEC.md");
    expect(result.argv).not.toContain("ignored");
  });

  it("plan: forwards --quick / --no-tests-synth / --no-plan-review flags", async () => {
    const { runKjCommand } = await import("../src/command-runner.js");
    const result = runKjCommand({ command: "plan", input: { taskFile: "/tmp/x.md", quick: true, noTestsSynth: true, noPlanReview: true } });
    expect(result.argv).toEqual(expect.arrayContaining(["--quick", "--no-tests-synth", "--no-plan-review"]));
  });

  it("clean: always passes --yes and conditionally --nuke", async () => {
    const { runKjCommand } = await import("../src/command-runner.js");
    const noNuke = runKjCommand({ command: "clean", input: {} });
    expect(noNuke.argv).toContain("--yes");
    expect(noNuke.argv).not.toContain("--nuke");

    const nuked = runKjCommand({ command: "clean", input: { nuke: true } });
    expect(nuked.argv).toContain("--nuke");
  });

  it("returns commandId + logPath the client can tail", async () => {
    const res = await request(app).post("/api/commands/plan").send({ task: "do thing" });
    expect(res.status).toBe(200);
    expect(res.body.commandId).toMatch(/^cmd-plan-/);
    expect(res.body.logPath).toMatch(/hu-board-runs\/cmd-plan-.+\.log$/);
  });
});

describe("GET /api/runs/:commandId/log", () => {
  it("returns exists:false when the log file hasn't been created yet", async () => {
    const res = await request(app).get("/api/runs/cmd-nope-1/log");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false, size: 0, content: "" });
  });

  it("tails the log by offset like the per-plan endpoint does", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(tmpHome, "hu-board-runs");
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, "cmd-x-1.log");
    fs.writeFileSync(logPath, "hello\nworld\n");
    const full = await request(app).get("/api/runs/cmd-x-1/log");
    expect(full.body.content).toBe("hello\nworld\n");
    fs.writeFileSync(logPath, "hello\nworld\n!!!\n");
    const delta = await request(app).get("/api/runs/cmd-x-1/log").query({ offset: 12 });
    expect(delta.body.content).toBe("!!!\n");
  });
});

describe("POST /api/board/restart", () => {
  it("acks immediately in echo mode without killing the test process", async () => {
    process.env.KJ_BOARD_RESTART_MODE = "echo";
    const res = await request(app).post("/api/board/restart");
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("echo");
    delete process.env.KJ_BOARD_RESTART_MODE;
  });
});
