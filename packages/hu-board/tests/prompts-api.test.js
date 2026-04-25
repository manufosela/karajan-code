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
    writeFileSync(join(dir, "prompt-2.json"), JSON.stringify({
      promptId: "prompt-2", sessionId: "s", question: "second?", createdAt: "2026-04-25T11:00:00Z",
    }));
    writeFileSync(join(dir, "prompt-1.json"), JSON.stringify({
      promptId: "prompt-1", sessionId: "s", question: "first?", createdAt: "2026-04-25T10:00:00Z",
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
