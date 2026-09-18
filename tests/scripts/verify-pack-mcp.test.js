// KJC-TSK-0844 — the MCP smoke of verify-pack, run here against the source
// tree: a fresh no-remote repo initialised by `kj init`, an isolated home,
// and the real server over stdio. No LLM: kj_review is expected to stop at
// its gate (no reviewer CLI, base branch…), never at "Missing required field".
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { classifyAnswer, mcpSmoke } from "../../scripts/verify-pack-mcp.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SERVER = path.join(ROOT, "src", "mcp", "server.js");
const KJ = path.join(ROOT, "bin", "kj.js");

describe("classifyAnswer", () => {
  it("a handler that never reached its gate is a failure; a gate refusal is an explicit pass", () => {
    expect(classifyAnswer("kj_review", JSON.stringify({ ok: false, error: "Missing required field: task (or pass taskFile with a .md path)" })).ok).toBe(false);
    expect(classifyAnswer("kj_review", "BOOTSTRAP FAILED\n  FAIL  config: Config file not found").ok).toBe(false);
    expect(classifyAnswer("kj_review", JSON.stringify({ ok: false, error: "taskFile read failed: ENOENT" })).ok).toBe(false);
    expect(classifyAnswer("kj_review", JSON.stringify({ ok: false, error: "Coder agent \"claude\" not found" }))).toMatchObject({ ok: true, gated: true });
    expect(classifyAnswer("kj_status", JSON.stringify({ lines: [] }))).toMatchObject({ ok: true, gated: false });
  });
});

describe("mcpSmoke against the source tree", () => {
  let tmp; let home; let env;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-mcp-smoke-"));
    home = path.join(tmp, "home");
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo, { recursive: true });
    const { CLAUDECODE: _omit, ...clean } = process.env;
    env = { ...clean, HOME: home, USERPROFILE: home, KARAJAN_HOME: path.join(home, ".karajan"), CI: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    const init = spawnSync(process.execPath, [KJ, "init", "--no-interactive", "--no-ollama", "--no-rtk", "--no-squeezr", "--no-qmd", "--no-sonar", "--no-harden"], { cwd: repo, env, encoding: "utf8", timeout: 180_000 });
    if (init.status !== 0) throw new Error(`kj init failed: ${(init.stderr || init.stdout || "").slice(-600)}`);
    execFileSync("git", ["checkout", "-q", "-b", "smoke/mcp"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "task.md"), "Add a greeting helper\n");
    fs.writeFileSync(path.join(repo, "hello.js"), "export const hi = () => 'hi';\n");
    execFileSync("git", ["add", "hello.js"], { cwd: repo });
  }, 240_000);
  afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("the server lists the tools, answers kj_status and kj_config, and kj_review reads the taskFile before its gate", async () => {
    const res = await mcpSmoke({ serverPath: SERVER, kjHome: env.KARAJAN_HOME, projectDir: path.join(tmp, "repo"), taskFile: "task.md", env });
    expect(res.findings, res.findings.join("\n")).toEqual([]);
    expect(res.ok).toBe(true);
    const review = res.answers.find((a) => a.tool === "kj_review");
    expect(review).toBeTruthy();
    // Said, not hidden: this runner has no reviewer, so the gate answers — and that is the pass.
    if (review.gated) {
      console.info(`kj_review reached its gate: ${review.reason}`);
      expect(review.reason).not.toMatch(/Missing required field|Config file not found/);
    }
  }, 180_000);
});
