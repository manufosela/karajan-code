// KJC-TSK-0683 — the ONNX election must merge into the project config
// surgically (never a full-config dump) and survive an existing file.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { onnxConfig, persistOnnxChoice } from "../../src/rag/onnx-fallback.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-onnx-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("onnxConfig", () => {
  it("swaps provider and dim without touching the rest", () => {
    const cfg = onnxConfig({ projectDir: "/p", rag: { autoUpdate: { onRun: true }, embedder: { model: "x" } } });
    expect(cfg.rag.embedder).toMatchObject({ provider: "onnx", dim: 384, model: "x" });
    expect(cfg.rag.autoUpdate.onRun).toBe(true);
    expect(cfg.projectDir).toBe("/p");
  });
});

describe("persistOnnxChoice", () => {
  it("creates the project config when none exists", async () => {
    const p = await persistOnnxChoice(dir);
    const written = yaml.load(fs.readFileSync(p, "utf8"));
    expect(written.rag.embedder).toEqual({ provider: "onnx", dim: 384 });
  });

  it("merges into an existing config preserving user keys AND comments", async () => {
    const configPath = path.join(dir, ".karajan", "kj.config.yml");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "# my precious comment\ncoder: claude\nrag:\n  autoUpdate:\n    onRun: false\n");
    await persistOnnxChoice(dir);
    const raw = fs.readFileSync(configPath, "utf8");
    expect(raw).toContain("# my precious comment"); // comments survive
    const written = yaml.load(raw);
    expect(written.coder).toBe("claude"); // untouched
    expect(written.rag.autoUpdate.onRun).toBe(false); // untouched
    expect(written.rag.embedder).toEqual({ provider: "onnx", dim: 384 });
  });
});
