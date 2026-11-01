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
    expect(res.body.commands).toEqual(["clean"]);
  });
});

// KJC-TSK-1323: kj plan (generate) and kj architect are retired in 5.0.
describe("POST /api/commands/:command, retired commands", () => {
  it.each(["plan", "architect"])("rejects %s with 400 and launches nothing", async (command) => {
    const res = await request(app).post(`/api/commands/${command}`).send({ task: "build login" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported command/);
    expect(res.body.commandId).toBeUndefined();
    expect(existsSync(join(tmpHome, "hu-board-runs"))).toBe(false);
  });
});

describe("POST /api/commands/:command", () => {
  it("rejects an unknown command name with 400", async () => {
    const res = await request(app).post("/api/commands/sudo").send({ task: "rm -rf /" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported command/);
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
    const res = await request(app).post("/api/commands/clean").send({ dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.commandId).toMatch(/^cmd-clean-/);
    expect(res.body.logPath).toMatch(/hu-board-runs\/cmd-clean-.+\.log$/);
  });
});

// KJC-TSK-1324: the ▶ of a card starts it in its lane (kj hu start <id> --code).
describe("startCardInLane", () => {
  let repo;
  beforeEach(async () => {
    const { mkdirSync } = await import("node:fs");
    repo = mkdtempSync(join(tmpdir(), "hu-board-repo-"));
    mkdirSync(join(repo, ".git"));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("launches kj hu start <id> --code in the project, or reports the lane the card already has", async () => {
    const { mkdirSync } = await import("node:fs");
    const { startCardInLane } = await import("../src/command-runner.js");
    const launched = startCardInLane({ id: "HU-42", projectDir: repo });
    expect(launched.argv.slice(-4)).toEqual(["hu", "start", "HU-42", "--code"]);
    expect(launched.commandId).toMatch(/^cmd-hu-start-/);
    mkdirSync(join(repo, ".kj", "worktrees", "HU-42-board-play"), { recursive: true });
    expect(startCardInLane({ id: "HU-42", projectDir: repo })).toMatchObject({ ok: false, lane: join(repo, ".kj", "worktrees", "HU-42-board-play") });
  });

  it.each([
    ["a crafted id", "HU-1;rm", () => repo],
    ["a relative project", "HU-1", () => "repo"],
    ["a folder that is not a git repo", "HU-1", () => tmpdir()],
  ])("refuses %s", async (_label, id, dir) => {
    const { startCardInLane } = await import("../src/command-runner.js");
    expect(startCardInLane({ id, projectDir: dir() })).toMatchObject({ ok: false });
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
