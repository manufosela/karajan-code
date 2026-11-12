// ADR 0055 step 2 (KJC-TSK-1558): in a transversal session runGuard judges each call
// as the child repo it touches. Real temp dirs, a real child process (stdin, chdir,
// exit) and a fake guard injected through runGuard's guards seam.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
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

  // Settled here without the guard: posttooluse across two repos records nothing; stop waits for its own step.
  it.each([["posttooluse", { tool_name: "Bash", tool_input: { command: "cp a/x b/y" } }, ""], ["stop", {}, "stop/session checks per repo come next"]])(
    "%s exits 0 without running its guard", (guard, call, note) => {
      const { status, err, seen } = run(guard, { ...call, cwd: parent });
      expect({ status, seen }).toEqual({ status: 0, seen: null });
      expect(err).toContain(note);
    });

  it("without the marker does not read stdin and hands it to the guard untouched", () => {
    fs.rmSync(path.join(parent, ".claude-transversal"));
    const payload = { tool_name: "Edit", tool_input: { file_path: path.join(parent, "notes.md") }, cwd: parent };
    const { status, seen } = run("pretooluse", payload);
    expect(status).toBe(0);
    expect(seen).toMatchObject({ dir: parent, cwd: parent, raw: JSON.stringify(payload), piped: true });
  });
});
