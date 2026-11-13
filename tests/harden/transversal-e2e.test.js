// ADR 0055 step 5 (KJC-TSK-1558): a transversal session over two child repos, end to
// end with the REAL guards, called as the host calls them: bin/kj-hook.js <guard>,
// the hook JSON on stdin, CLAUDE_PROJECT_DIR and cwd the parent. kj on the PATH is
// this tree's (the stop guard runs kj sentinel verify), never the installed one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readRagLedger } from "../../src/review/rag-ledger.js";

const HOOK = fileURLToPath(new URL("../../bin/kj-hook.js", import.meta.url));
const KJ = fileURLToPath(new URL("../../bin/kj.js", import.meta.url));
const GUARDS = new URL("../../src/harden/sentinel-guards.js", import.meta.url).href;
const SID = "e2e";

describe("a transversal session over two child repos, real guards (ADR 0055 step 5)", () => {
  let root, parent, a, b, env;
  const state = (repo) => path.join(repo, ".karajan", "harness", "sentinel-state.json");
  const hook = (guard, payload) => {
    const res = spawnSync(process.execPath, [HOOK, guard], {
      cwd: parent, env: { ...env, CLAUDE_PROJECT_DIR: parent }, input: JSON.stringify({ session_id: SID, cwd: parent, ...payload }), encoding: "utf8", timeout: 60_000,
    });
    return { status: res.status, err: res.stderr || "", out: res.stdout || "" };
  };
  const repo = (name) => {
    const dir = path.join(parent, name);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { env, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "src", "x.js"), "export const x = 1;\n");
    git("add", ".");
    git("-c", "user.name=e2e", "-c", "user.email=e2e@test.local", "commit", "-q", "-m", "chore: init");
    return fs.realpathSync(dir);
  };
  const editA = { tool_name: "Edit", tool_input: { file_path: "", old_string: "1", new_string: "2" } };
  // A session opened inside a: CLAUDE_PROJECT_DIR and cwd are a.
  const inA = (args, payload) => spawnSync(process.execPath, args, {
    cwd: a, env: { ...env, CLAUDE_PROJECT_DIR: a }, input: JSON.stringify({ session_id: SID, cwd: a, ...payload }), encoding: "utf8", timeout: 60_000,
  });
  const own = (guard, payload) => {
    const res = inA([HOOK, guard], payload);
    return { status: res.status, err: res.stderr || "", out: res.stdout || "" };
  };
  const withoutMarker = (fn) => {
    const marker = path.join(parent, ".claude-transversal");
    fs.renameSync(marker, `${marker}.off`);
    try { return fn(); } finally { fs.renameSync(`${marker}.off`, marker); }
  };

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-transversal-e2e-")));
    parent = path.join(root, "ws");
    const bin = path.join(root, "bin");
    fs.mkdirSync(parent);
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\nexec "${process.execPath}" "${KJ}" "$@"\n`, { mode: 0o755 });
    env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, KARAJAN_HOME: path.join(root, "kjhome"), KJ_SENTINEL_OFF: "", CLAUDECODE: "" };
    for (const k of Object.keys(env)) if (k.startsWith("GIT_") || k === "VITEST") delete env[k];
    fs.writeFileSync(path.join(parent, ".claude-transversal"), "");
    a = repo("a");
    b = repo("b");
    editA.tool_input.file_path = path.join(a, "src", "x.js");
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("1. a kj rag query run in a lands in a's ledger, not in the parent nor in b", () => {
    const stdout = "[code · x · score=0.91] src/x.js\n";
    const res = hook("posttooluse", { tool_name: "Bash", tool_input: { command: "cd a && kj rag query where is x" }, tool_response: { stdout } });
    expect(res.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(state(a), "utf8")).sessions[SID].rag_hits).toEqual(["src/x.js"]);
    expect([fs.existsSync(path.join(parent, ".karajan")), fs.existsSync(path.join(b, ".karajan"))]).toEqual([false, false]);
    expect(readRagLedger(a)).toMatchObject({ available: true, sessionId: SID, hits: ["src/x.js"] });
  });

  // a sits on its base branch with no card: a's own card-first rule answers.
  it("2. an Edit of a/src/x.js is judged with a's rules and leaves b untouched", () => {
    const res = hook("pretooluse-sentinel", editA);
    expect(res.status).toBe(2);
    expect(res.err).toContain("no se editan fuentes en la rama base 'main'");
    expect(res.err).not.toMatch(/transversal session/);
    expect(fs.existsSync(path.join(b, ".karajan"))).toBe(false);
  });

  it("3. a Bash cp from a to b is refused naming both repos", () => {
    const res = hook("pretooluse-sentinel", { tool_name: "Bash", tool_input: { command: "cp a/x b/y" } });
    expect(res.status).toBe(2);
    expect(res.err).toContain(`${a}, ${b}: one repository per call`);
  });

  it("4. an Edit of <parent>/notes.md is refused: no repository governs it", () => {
    const res = hook("pretooluse-sentinel", { tool_name: "Edit", tool_input: { file_path: path.join(parent, "notes.md") } });
    expect(res.status).toBe(2);
    expect(res.err).toContain(`no repository under ${parent}`);
  });

  // Only a session opened in the parent is transversal: one opened in a is a's own, as before ADR 0055.
  it("5. a session opened inside a gives what it gives without the marker, stdin left to the guard", () => {
    const marked = own("pretooluse-sentinel", editA);
    expect(withoutMarker(() => own("pretooluse-sentinel", editA))).toEqual(marked);
    expect(marked.err).not.toMatch(/transversal session/);
    const probe = `import { Socket } from "node:net";
import { runGuard } from ${JSON.stringify(GUARDS)};
await runGuard("pretooluse", { guards: { pretooluse: () => process.stdout.write(String(process.stdin instanceof Socket)) } });`;
    expect(inA(["--input-type=module", "-e", probe], editA).stdout).toBe("true");
  });

  // a is not hardened, so its own stop is red (kj sentinel verify): the parent's stop says a's lines, a's alone.
  it("6. stop for the session runs a's stop only", () => {
    const res = hook("stop", {});
    const mine = own("stop", {});
    expect([res.status, mine.status]).toEqual([2, 2]);
    expect(res.err.trim()).toBe(mine.err.trim().split("\n").map((l) => `a: ${l}`).join("\n"));
    expect(fs.existsSync(path.join(b, ".karajan"))).toBe(false);
  });

  it("7. without the marker the parent is the root again, as before ADR 0055", () => {
    fs.rmSync(path.join(parent, ".claude-transversal"));
    const res = hook("pretooluse-sentinel", { tool_name: "Edit", tool_input: { file_path: path.join(parent, "notes.md") } });
    expect(res.status).toBe(0);
    expect(res.err).not.toMatch(/transversal session/);
  });
});
