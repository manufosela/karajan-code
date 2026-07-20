// ENV-F1 (KJC-TSK-0643): headless pipeline sessions stamp their (already
// cross-AI-reviewed) verdict for the staged diff so the v4 pre-commit gate
// lets the pipeline's own commits through. Gate absent → zero side effects.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stampStagedVerdict, checkVerdict } from "../../src/review/verdict-store.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-stamp-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.js"), "const x = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("stampStagedVerdict", () => {
  it("no gate marker → does nothing", async () => {
    const res = await stampStagedVerdict({ projectDir: dir, reviewer: "codex" });
    expect(res.stamped).toBe(false);
    expect(fs.existsSync(path.join(dir, ".karajan", "reviews"))).toBe(false);
  });

  it("gate marker + staged changes → approved verdict the gate accepts", async () => {
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "review-gate"), "");
    const res = await stampStagedVerdict({ projectDir: dir, reviewer: "codex", summary: "pipeline reviewer approved" });
    expect(res.stamped).toBe(true);
    const staged = execFileSync("git", ["diff", "--cached"], { cwd: dir, encoding: "utf8" });
    const check = await checkVerdict(dir, staged);
    expect(check.ok).toBe(true);
    expect(check.verdict.reviewer).toBe("codex");
    expect(check.verdict.host).toBe("kj-pipeline");
  });

  it("gate marker but empty staged diff → does not stamp", async () => {
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "seed"], { cwd: dir });
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "review-gate"), "");
    const res = await stampStagedVerdict({ projectDir: dir, reviewer: "codex" });
    expect(res.stamped).toBe(false);
  });
});
