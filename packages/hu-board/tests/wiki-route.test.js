// KJC-TSK-0508 — Tests for POST /api/wiki/query. Mocks runCommand so the
// handler logic stays hermetic; no real qmd binary is required.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../../src/utils/process.js", () => ({ runCommand: vi.fn() }));

import { runCommand } from "../../../src/utils/process.js";
import wikiRoutes from "../src/routes/wiki.js";

let app;
beforeEach(() => {
  vi.resetAllMocks();
  app = express();
  app.use(express.json());
  app.use("/api/wiki", wikiRoutes);
});

describe("POST /api/wiki/query", () => {
  it("returns 400 when query is missing or blank", async () => {
    const res = await request(app).post("/api/wiki/query").send({ query: "   " });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "query is required" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("spawns qmd query with format json and parsed results on success", async () => {
    const hits = [{ source: "docs/spec.md", snippet: "hello" }];
    runCommand.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify(hits), stderr: "" });
    const res = await request(app).post("/api/wiki/query").send({ query: "auth flow" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, results: hits, count: 1 });
    const args = runCommand.mock.calls[0][1];
    expect(args.slice(0, 6)).toEqual(["query", "auth flow", "--format", "json", "-n", "10"]);
  });

  it("clamps limit and forwards collection + --no-rerank when fast=true", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "[]", stderr: "" });
    await request(app).post("/api/wiki/query").send({ query: "x", limit: 999, collection: "karajan-docs", fast: true });
    const args = runCommand.mock.calls[0][1];
    expect(args).toContain("-c"); expect(args).toContain("karajan-docs");
    expect(args).toContain("--no-rerank");
    expect(args[args.indexOf("-n") + 1]).toBe("50");
  });

  it("returns 503 installable:true when qmd binary is missing (ENOENT)", async () => {
    runCommand.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = await request(app).post("/api/wiki/query").send({ query: "x" });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: "qmd not installed", installable: true });
  });

  it("returns 503 when exitCode=127 (shell not-found fallback)", async () => {
    runCommand.mockResolvedValue({ exitCode: 127, stdout: "", stderr: "qmd: command not found" });
    const res = await request(app).post("/api/wiki/query").send({ query: "x" });
    expect(res.status).toBe(503);
    expect(res.body.installable).toBe(true);
  });

  it("returns 500 with qmd stderr when query fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 2, stdout: "", stderr: "boom: index empty" });
    const res = await request(app).post("/api/wiki/query").send({ query: "x" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: "boom: index empty" });
  });

  it("returns 500 when qmd stdout is not valid JSON", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "not-json", stderr: "" });
    const res = await request(app).post("/api/wiki/query").send({ query: "x" });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not valid JSON/);
  });
});
