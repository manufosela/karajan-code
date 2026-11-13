// ADR 0055 step 2 (KJC-TSK-1558): in a transversal session runGuard judges each call
// as the child repo it touches. Real temp dirs, a real child process (stdin, chdir,
// exit) and a fake guard injected through runGuard's guards seam.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GUARDS = pathToFileURL(path.resolve("src/harden/sentinel-guards.js")).href;
const FAKE = `import { Socket } from "node:net";
const piped = process.stdin instanceof Socket;
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ dir: process.env.CLAUDE_PROJECT_DIR ?? null, cwd: process.cwd(), raw, piped }));
});
`;

const gitInit = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  return fs.realpathSync(dir);
};

describe("runGuard in a transversal session (ADR 0055 step 2)", () => {
  let parent, a, fake;
  const run = (name, payload, cwd = parent) => {
    const script = `import { runGuard } from ${JSON.stringify(GUARDS)};
const fake = () => import(${JSON.stringify(pathToFileURL(fake).href)});
await runGuard(${JSON.stringify(name)}, { guards: { [${JSON.stringify(name)}]: fake } });`;
    const env = { ...process.env, CLAUDE_PROJECT_DIR: cwd };
    const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd, env, input: JSON.stringify(payload), encoding: "utf8" });
    return { status: res.status, err: res.stderr, seen: res.stdout ? JSON.parse(res.stdout) : null };
  };

  beforeEach(() => {
    parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-transversal-guard-")));
    fs.writeFileSync(path.join(parent, ".claude-transversal"), "");
    a = gitInit(path.join(parent, "a"));
    gitInit(path.join(parent, "b"));
    fake = path.join(parent, "fake-guard.mjs");
    fs.writeFileSync(fake, FAKE);
  });
  afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

  it("runs the guard as the one child repo an Edit touches, with the same stdin bytes", () => {
    const payload = { tool_name: "Edit", tool_input: { file_path: path.join(a, "x.js") }, cwd: parent };
    const { status, seen } = run("pretooluse", payload);
    expect(status).toBe(0);
    expect(seen).toMatchObject({ dir: a, cwd: a, raw: JSON.stringify(payload) });
  });

  // A bare operand names a directory; a quoted message is one word; a word that is no directory (git, status) adds nothing;
  // a path outside the parent (../outside read from it, ~/x, /dev/null) is the child's guards' to judge; posttooluse never refuses.
  it.each([["pretooluse", "cd a && git status", "a", ""], ["pretooluse", "git -C b status", "b", ""], ["pretooluse", 'git -C b commit -m "fix a bug"', "b", ""],
    ["pretooluse", "git -C ../b status", "b", "a"], ["pretooluse", "cp a/f ../outside", "a", ""], ["pretooluse", "cmd a/f > /dev/null", "a", ""],
    ["posttooluse", "cp a/f notes.md", "a", ""], ["pretooluse", "cp a/f ~/x", "a", ""]])(
    "%s runs %s as the one child repo its words name", (guard, command, child, from) => {
      const { status, seen } = run(guard, { tool_name: "Bash", tool_input: { command }, cwd: path.join(parent, from) });
      expect(status).toBe(0);
      expect(seen).toMatchObject({ dir: path.join(parent, child), cwd: path.join(parent, child) });
    });

  // Each refusal says why (<P> is the parent): two repos, none, or a path in the parent that no repository governs.
  it.each([
    ["pretooluse", "Bash", { command: "cp a/x b/y" }, "<P>/a, <P>/b: one repository per call"],
    ["pretooluse", "Bash", { command: "git status" }, "no repository under <P>"],
    ["pretooluse-sentinel", "Edit", { file_path: "notes.md" }, "no repository under <P>"],
    ["pretooluse", "Bash", { command: "cp a/f notes.md" }, "touches <P>/notes.md, inside <P> but in no repository"],
    ["pretooluse-rules", "Bash", { command: "cd a && cp f ../notes.md" }, "touches <P>/notes.md, inside <P> but in no repository"],
  ])("%s refuses a %s call %j from the parent", (guard, tool_name, tool_input, why) => {
    const { status, err, seen } = run(guard, { tool_name, tool_input, cwd: parent });
    expect({ status, seen }).toEqual({ status: 2, seen: null });
    expect(err).toContain(why.replaceAll("<P>", () => parent));
  });

  it("posttooluse across two repos exits 0 without running its guard", () => {
    const { status, seen } = run("posttooluse", { tool_name: "Bash", tool_input: { command: "cp a/x b/y" }, cwd: parent });
    expect({ status, seen }).toEqual({ status: 0, seen: null });
  });

  // ADR 0055 step 3: Stop runs the child's own stop in every repo whose state holds this session.
  const STOP_FAKE = `import fs from "node:fs";
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  const sid = JSON.parse(raw).session_id;
  const st = JSON.parse(fs.readFileSync(".karajan/harness/sentinel-state.json", "utf8"));
  if (st.sessions[sid]?.red && process.env.CLAUDE_PROJECT_DIR === process.cwd()) { console.error("red in " + process.cwd()); process.exit(2); }
  process.exit(0);
});
`;
  const stateIn = (repo, sessions) => {
    fs.mkdirSync(path.join(repo, ".karajan", "harness"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".karajan", "harness", "sentinel-state.json"), JSON.stringify({ sessions }));
  };
  it.each([["s1", 2, ["a: red in <P>/a"]], ["s9", 0, []]])("stop for session %s judges only the repos it touched", (sid, code, lines) => {
    fs.writeFileSync(fake, STOP_FAKE);
    stateIn(a, { s1: { red: true } });
    stateIn(path.join(parent, "b"), { s2: { red: true } });
    const { status, err } = run("stop", { session_id: sid, cwd: parent });
    expect(status).toBe(code);
    expect(err.split("\n").filter((l) => l.includes("red in"))).toEqual(lines.map((l) => l.replaceAll("<P>", () => parent)));
  });

  it("sessionstart names the child repos and does not run their guard", () => {
    const res = spawnSync(process.execPath, ["--input-type=module", "-e", `import { runGuard } from ${JSON.stringify(GUARDS)};
await runGuard("sessionstart", { guards: { sessionstart: () => { throw new Error("ran"); } } });`], { cwd: parent, env: { ...process.env, CLAUDE_PROJECT_DIR: parent }, input: "{}", encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).hookSpecificOutput.additionalContext).toContain("a, b");
  });

  it("kj sentinel status (stop --status) never waits on a stdin that stays open", async () => {
    const script = `import { runGuard } from ${JSON.stringify(GUARDS)};
process.argv.push("--status");
await runGuard("stop", { guards: { stop: () => process.exit(0) } });`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: parent, env: { ...process.env, CLAUDE_PROJECT_DIR: parent }, stdio: ["pipe", "ignore", "ignore"] });
    const code = await Promise.race([new Promise((ok) => child.on("exit", ok)), new Promise((ok) => setTimeout(() => ok("hung"), 5000))]);
    child.kill();
    expect(code).toBe(0);
  });

  it("without the marker does not read stdin and hands it to the guard untouched", () => {
    fs.rmSync(path.join(parent, ".claude-transversal"));
    const payload = { tool_name: "Edit", tool_input: { file_path: path.join(parent, "notes.md") }, cwd: parent };
    const { status, seen } = run("pretooluse", payload);
    expect(status).toBe(0);
    expect(seen).toMatchObject({ dir: parent, cwd: parent, raw: JSON.stringify(payload), piped: true });
  });
});
