/**
 * KJC-TSK-1022 (QS-A): a throwaway project with the REAL Karajan harness, so a
 * scenario runs the gates together, the way a session meets them.
 *
 * - The project is a temp git repo with a package.json and an initial commit.
 * - `kj` on its PATH is a shim to THIS tree's bin/kj.js: a scenario never runs
 *   the globally installed kj (the link can break; a stale kj tests nothing).
 * - `hook(name, payload)` runs one Sentinel script with the JSON stdin Claude
 *   Code would send, from the project root, and returns its exit and stderr.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KJ_BIN = path.resolve(HERE, "..", "..", "..", "bin", "kj.js");
const KJ_HOOK_BIN = path.resolve(HERE, "..", "..", "..", "bin", "kj-hook.js");
const FAKE_AGENT = path.resolve(HERE, "..", "..", "e2e", "fixtures", "fake-coder.js");
const OFFLINE_RUN = path.join(HERE, "offline-run.js");

export function makeScenarioProject({ prefix = "kj-scn-" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dir = path.join(root, "project");
  const bin = path.join(root, "bin");
  const kjHome = path.join(root, "kjhome");
  fs.mkdirSync(dir);
  fs.mkdirSync(bin);
  fs.mkdirSync(kjHome);
  const shim = path.join(bin, "kj");
  fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${KJ_BIN}" "$@"\n`, { mode: 0o755 });

  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    KARAJAN_HOME: kjHome,
    CLAUDECODE: "",
    CI: "1",
  };
  delete env.VITEST; // the harness under test must behave as in a real session
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "scenario@test.local");
  git("config", "user.name", "scenario");
  fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "scn", version: "1.0.0", private: true, scripts: { test: "true" } }, null, 2)}\n`);
  git("add", "package.json");
  git("commit", "-q", "-m", "chore: init");

  const kj = (...args) => spawnSync(shim, args, { cwd: dir, env, encoding: "utf8", timeout: 180_000 });
  /** kj with the e2e fake agent registered (agents read their script from fixtureDir). */
  const kjFake = (fixtureDir, ...args) => spawnSync(shim, args, {
    cwd: dir, encoding: "utf8", timeout: 180_000,
    env: {
      ...env, TEST_FIXTURE_DIR: fixtureDir,
      NODE_OPTIONS: [env.NODE_OPTIONS, ...[OFFLINE_RUN, FAKE_AGENT].map((f) => `--import=${pathToFileURL(f).href}`)].filter(Boolean).join(" "),
    },
  });

  /** Run a Sentinel guard as Claude Code would: this tree's kj-hook, the project named by the host (ADR 0030). */
  const hook = (name, payload) => {
    const res = spawnSync(process.execPath, [KJ_HOOK_BIN, name.replace(/\.mjs$/, "")], {
      cwd: dir, env: { ...env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8", input: JSON.stringify({ session_id: "scn", cwd: dir, ...payload }), timeout: 120_000,
    });
    return { status: res.status, stderr: res.stderr || "", stdout: res.stdout || "" };
  };
  const bash = (command) => hook("pretooluse-sentinel.mjs", { tool_name: "Bash", tool_input: { command } });

  return { root, dir, env, kjHome, git, kj, kjFake, hook, bash, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
