/**
 * TSK-0325 — integration tests for the /api/pipeline/* routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import request from "supertest";

let tmpDir;
let app;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "hu-board-pipeline-"));
  process.env.KJ_PROJECT_DIR = tmpDir;

  // Seed a journal directory
  const reviewsDir = join(tmpDir, ".reviews", "demo-session");
  fs.mkdirSync(reviewsDir, { recursive: true });
  fs.writeFileSync(
    join(reviewsDir, "iterations.md"),
    "# Iterations\n\n## Iteration 1\n**Duration**: 1m\n### Coder\ndone\n### Reviewer\nApproved\n",
    "utf8"
  );
  fs.writeFileSync(
    join(reviewsDir, "decisions.md"),
    "# Decisions\n\n## Solomon consult\nused Solomon\n",
    "utf8"
  );
  fs.writeFileSync(
    join(reviewsDir, "summary.md"),
    "Session overview.\n\n## Stages\ntable here\n",
    "utf8"
  );
  fs.writeFileSync(join(reviewsDir, "tree.txt"), "src/\n  foo.js\n", "utf8");

  const { default: pipelineRoutes } = await import("../src/routes/pipeline.js");
  app = express();
  app.use("/api/pipeline", pipelineRoutes);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_PROJECT_DIR;
});

describe("GET /api/pipeline/sessions", () => {
  it("returns 200 and a sessions array", async () => {
    const res = await request(app).get("/api/pipeline/sessions");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
    expect(res.body.sessions.map((s) => s.id)).toContain("demo-session");
    expect(res.body.sessions[0]).toHaveProperty("mtime");
  });
});

describe("GET /api/pipeline/sessions/:id", () => {
  it("returns the full parsed journal", async () => {
    const res = await request(app).get("/api/pipeline/sessions/demo-session");
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.iterations).toHaveLength(1);
    expect(res.body.iterations[0].stages.map((s) => s.name)).toContain("Coder");
    expect(res.body.decisions[0].heading).toContain("Solomon");
    expect(res.body.summary.sections[0].heading).toBe("Stages");
    expect(res.body.tree).toContain("src/");
  });

  it("returns 404 for unknown sessions", async () => {
    const res = await request(app).get("/api/pipeline/sessions/not-a-real-session");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'session "not-a-real-session" not found' });
  });
});
