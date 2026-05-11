import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import request from "supertest";

let tmp;
let app;
let dbMod;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "hu-board-prompts-"));
  process.env.KJ_HOME = tmp;
  dbMod = await import("../src/db.js");
  dbMod.initDb();
  const { default: apiRoutes } = await import("../src/routes/api.js");
  app = express();
  app.use(express.json());
  app.use("/api", apiRoutes);
});

afterEach(() => {
  dbMod.closeDb();
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

describe("GET /api/prompts", () => {
  it("returns [] when no prompts dir exists", async () => {
    const res = await request(app).get("/api/prompts");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns the pending prompts sorted by createdAt", async () => {
    const dir = join(tmp, "prompts");
    mkdirSync(dir);
    // Use relative timestamps so the test is robust against the zombie-TTL
    // filter (KJC-BUG-0038): both must be within the live window.
    const t1 = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const t2 = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    writeFileSync(join(dir, "prompt-2.json"), JSON.stringify({
      promptId: "prompt-2", sessionId: "s", question: "second?", createdAt: t2,
    }));
    writeFileSync(join(dir, "prompt-1.json"), JSON.stringify({
      promptId: "prompt-1", sessionId: "s", question: "first?", createdAt: t1,
    }));
    const res = await request(app).get("/api/prompts");
    expect(res.status).toBe(200);
    expect(res.body.map((p) => p.promptId)).toEqual(["prompt-1", "prompt-2"]);
  });

  it("ignores answer.json files (they're not pending prompts)", async () => {
    const dir = join(tmp, "prompts");
    mkdirSync(dir);
    writeFileSync(join(dir, "prompt-x.answer.json"), JSON.stringify({ answer: "x" }));
    const res = await request(app).get("/api/prompts");
    expect(res.body).toEqual([]);
  });

  it("skips malformed prompt files instead of 500ing", async () => {
    const dir = join(tmp, "prompts");
    mkdirSync(dir);
    writeFileSync(join(dir, "good.json"), JSON.stringify({ promptId: "good", question: "?" }));
    writeFileSync(join(dir, "bad.json"), "not json {{{");
    const res = await request(app).get("/api/prompts");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].promptId).toBe("good");
  });

  // KJC-BUG-0038: zombie prompts (runner crashed) must NOT keep showing
  // the modal forever. After 30 minutes the GET drops them and unlinks
  // the file from disk.
  it("filters out zombie prompts older than the 30min TTL and deletes the file", async () => {
    const dir = join(tmp, "prompts");
    mkdirSync(dir);
    const oldTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const zombiePath = join(dir, "prompt-zombie.json");
    writeFileSync(zombiePath, JSON.stringify({ promptId: "prompt-zombie", question: "?", createdAt: oldTs }));
    writeFileSync(join(dir, "prompt-fresh.json"), JSON.stringify({ promptId: "prompt-fresh", question: "?", createdAt: new Date().toISOString() }));

    const res = await request(app).get("/api/prompts");
    expect(res.status).toBe(200);
    expect(res.body.map(p => p.promptId)).toEqual(["prompt-fresh"]);
    expect(existsSync(zombiePath)).toBe(false);
  });

  it("keeps a fresh prompt (createdAt 5 min old) — TTL does not over-fire", async () => {
    const dir = join(tmp, "prompts");
    mkdirSync(dir);
    const recentTs = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const p = join(dir, "prompt-recent.json");
    writeFileSync(p, JSON.stringify({ promptId: "prompt-recent", question: "?", createdAt: recentTs }));
    const res = await request(app).get("/api/prompts");
    expect(res.body.map(x => x.promptId)).toEqual(["prompt-recent"]);
    expect(existsSync(p)).toBe(true);
  });

  it("uses file mtime as fallback when createdAt is missing", async () => {
    const dir = join(tmp, "prompts");
    mkdirSync(dir);
    const p = join(dir, "prompt-legacy.json");
    writeFileSync(p, JSON.stringify({ promptId: "prompt-legacy", question: "?" })); // no createdAt
    // Backdate mtime by 1 hour
    const { utimesSync } = await import("node:fs");
    const past = (Date.now() - 60 * 60 * 1000) / 1000;
    utimesSync(p, past, past);
    const res = await request(app).get("/api/prompts");
    expect(res.body).toEqual([]);
    expect(existsSync(p)).toBe(false);
  });
});

describe("POST /api/prompts/:promptId/answer", () => {
  it("returns 404 when the prompt doesn't exist", async () => {
    const res = await request(app).post("/api/prompts/nope/answer").send({ answer: "x" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the body has no answer string", async () => {
    const dir = join(tmp, "prompts");
    mkdirSync(dir);
    writeFileSync(join(dir, "prompt-x.json"), JSON.stringify({ promptId: "prompt-x", question: "?" }));
    const res = await request(app).post("/api/prompts/prompt-x/answer").send({});
    expect(res.status).toBe(400);
  });

  it("writes a sibling .answer.json the runner can pick up", async () => {
    const dir = join(tmp, "prompts");
    mkdirSync(dir);
    writeFileSync(join(dir, "prompt-x.json"), JSON.stringify({ promptId: "prompt-x", question: "?" }));

    const res = await request(app).post("/api/prompts/prompt-x/answer").send({ answer: "yes please" });
    expect(res.status).toBe(200);

    const answerPath = join(dir, "prompt-x.answer.json");
    expect(existsSync(answerPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(answerPath, "utf-8"));
    expect(parsed.answer).toBe("yes please");
    expect(typeof parsed.answeredAt).toBe("string");
  });

  it("accepts the literal string 'stop' as a valid answer (signals abort)", async () => {
    const dir = join(tmp, "prompts");
    mkdirSync(dir);
    writeFileSync(join(dir, "prompt-x.json"), JSON.stringify({ promptId: "prompt-x", question: "?" }));
    const res = await request(app).post("/api/prompts/prompt-x/answer").send({ answer: "stop" });
    expect(res.status).toBe(200);
  });
});
