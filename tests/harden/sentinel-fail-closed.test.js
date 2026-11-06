// KJC-BUG-0501: the Sentinel ran every gate inside one try whose catch let the command through,
// so one gate that threw waved all the later ones past. A gate that fails now stops a mutating
// tool, a state file that is valid JSON of the wrong type reads as empty, and the release check
// fails closed like the merge gate.
import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";
import { declareTestIdentity } from "./_test-identity.js";

let dir, idEnv, bin, state;
const harness = (name) => path.join(dir, ".karajan", "harness", name);
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-fail-closed-"));
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0001-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  placeGuardCopies(dir);
  idEnv = declareTestIdentity(dir);
  state = harness("sentinel-state.json");
  fs.writeFileSync(state, JSON.stringify({ sessions: { s1: { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0, rag_index_empty: true } } }));
  bin = path.join(dir, "fakebin");
  fs.mkdirSync(bin);
  // kj says no to the merge, and the supervisor reads as tampered.
  fs.writeFileSync(path.join(bin, "kj"), '#!/bin/sh\n[ "$1" = "merge-gate" ] && { echo "merge-gate: red: lint" >&2; exit 2; }\n[ "$1" = "sentinel" ] && { echo \'{"mismatched":["pretooluse-sentinel.mjs"]}\'; exit 1; }\nexit 0\n', { mode: 0o755 });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (hook, tool, input, PATH = `${bin}:${process.env.PATH}`) => spawnSync("node", [harness(hook)], {
  input: JSON.stringify({ session_id: "s1", tool_name: tool, tool_input: input }),
  encoding: "utf8", cwd: dir, env: { ...process.env, ...idEnv, PATH },
});
const bash = (command, PATH) => run("pretooluse-sentinel.mjs", "Bash", { command }, PATH);

describe("Sentinel fails closed", () => {
  it("a gate that throws stops the command instead of waving the later gates past", () => {
    const trap = fs.mkdtempSync(path.join(os.tmpdir(), "kj-trap-"));
    fs.mkdirSync(path.join(trap, "hosts.yml"));
    const res = bash(`GH_CONFIG_DIR=${trap} gh --version; gh pr merge 12`);
    fs.rmSync(trap, { recursive: true, force: true });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/no se ejecuta sin comprobar/);
  });

  it("a state file holding null or a number reads as empty, and every gate still runs", () => {
    for (const body of ["null", "7", "[]"]) {
      fs.writeFileSync(state, body);
      expect(bash("gh pr merge 12").status, body).toBe(2);
      expect(bash("git commit --no-verify -m x").status, body).toBe(2);
      fs.writeFileSync(state, body);
      expect(run("stop.mjs", "Stop", {}).status, body).toBe(2);
    }
  });

  it("publishing is stopped when kj cannot answer the release check", () => {
    const lonely = path.join(dir, "lonelybin");
    fs.mkdirSync(lonely);
    fs.symlinkSync(process.execPath, path.join(lonely, "node"));
    const res = bash("npm publish", lonely);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/release check/);
  });
});
