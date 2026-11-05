// KJC-BUG-0494: the Sentinel asks kj before every gh pr merge and stops it while the PR's CI
// runs or is red. kj is a fake at the front of PATH: the hook's leg only, the verdict has its
// own suite (tests/guards/merge-gate.test.js).
import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";
import { declareTestIdentity, TEST_GH_USER } from "./_test-identity.js";

let dir, gate, idEnv, bin;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-merge-gate-"));
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0001-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  placeGuardCopies(dir);
  idEnv = declareTestIdentity(dir);
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  fs.writeFileSync(path.join(dir, ".karajan", "harness", "sentinel-state.json"), JSON.stringify({ sessions: { s1: { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0, rag_index_empty: true } } }));
  bin = path.join(dir, "fakebin");
  fs.mkdirSync(bin);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const fakeKj = (script) => fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
const bash = (command) => spawnSync("node", [gate], {
  input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }),
  encoding: "utf8",
  env: { ...process.env, ...idEnv, PATH: `${bin}:${process.env.PATH}` },
});

describe("Sentinel merge gate", () => {
  it("stops gh pr merge with kj's reason when the PR's checks say no", () => {
    fakeKj('[ "$1" = "merge-gate" ] && { echo "merge-gate: still running: Test" >&2; exit 2; }\nexit 0');
    const res = bash(`gh auth switch --user ${TEST_GH_USER} && gh pr merge 12 --merge`);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/still running: Test/);
    expect(res.stderr).toMatch(/--auto/);
  });

  it("hands kj the exact command, and lets the merge run when kj allows it", () => {
    const seen = path.join(dir, "seen.txt");
    fakeKj(`[ "$1" = "merge-gate" ] && printf '%s' "$3" > ${seen}\nexit 0`);
    expect(bash("gh pr merge 12 --merge").status).toBe(0);
    expect(fs.readFileSync(seen, "utf8")).toBe("gh pr merge 12 --merge");
  });

  it("asks kj about a merge spelled the way only the shell reads as gh pr merge", () => {
    fakeKj('[ "$1" = "merge-gate" ] && { echo "merge-gate: red: lint" >&2; exit 2; }\nexit 0');
    expect(bash("g\\h pr merge 12").status).toBe(2);
  });

  it("fails closed: a merge kj could not check does not run", () => {
    fakeKj("exit 1");
    expect(bash("gh pr merge 12").status).toBe(2);
    fs.rmSync(path.join(bin, "kj"));
    const lonely = path.join(dir, "lonelybin");
    fs.mkdirSync(lonely);
    fs.symlinkSync(process.execPath, path.join(lonely, "node"));
    const res = spawnSync("node", [gate], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: "gh pr merge 12" } }), encoding: "utf8", env: { ...process.env, ...idEnv, PATH: lonely } });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/no pudo ejecutarse/);
  });

  it("does not ask kj for a command that merges nothing", () => {
    fakeKj("exit 2");
    expect(bash("gh pr view 12").status).toBe(0);
  });
});
