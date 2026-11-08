// HU-3533 (KJC-TSK-1445): a card planned with a tier is written by kj code, in a clean context and
// on the model of its tier, as kj run did. The Sentinel stops the orchestrating agent once per card
// before it writes that code itself; a second try passes and is recorded. kj is a fake at the front
// of PATH, answering kj hu tier.
import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";
import { declareTestIdentity } from "./_test-identity.js";

let dir, gate, idEnv, bin, statePath;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-delegate-"));
  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git checkout -q -b feat/HU-7-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  placeGuardCopies(dir);
  idEnv = declareTestIdentity(dir);
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
  fs.writeFileSync(statePath, JSON.stringify({ sessions: { s1: { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0, rag_index_empty: true } } }));
  bin = path.join(dir, "fakebin");
  fs.mkdirSync(bin);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// KJC-BUG-0518: run inside a kj code coder, process.env carries the coder's role, which the gate
// steps aside for; the hook starts from the environment of a plain shell.
const CODER_ONLY_VARS = new Set(["KJ_POLICY_ROLE", "CLAUDE_CODE_CHILD_SESSION"]);
const shellEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !CODER_ONLY_VARS.has(name)));
const calls = () => path.join(dir, "kj-calls.txt");
const fakeKj = (tier) => fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\necho "$@" >> ${calls()}\n[ "$1 $2" = "hu tier" ] && { echo '{"id":"'$3'","tier":${tier}}'; exit 0; }\nexit 0\n`, { mode: 0o755 });
const edit = (file, env = {}) => spawnSync("node", [gate], {
  input: JSON.stringify({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(dir, file) } }),
  encoding: "utf8",
  env: { ...shellEnv(), ...idEnv, PATH: `${bin}:${process.env.PATH}`, ...env },
});
const delegate = () => JSON.parse(fs.readFileSync(statePath, "utf8")).sessions.s1.delegate;

describe("Sentinel: a card planned with a tier is written by kj code", () => {
  it("stops the first code edit of the card once, with the command, and lets the second through, recorded", () => {
    fakeKj('"trivial"');
    const first = edit("src/a.js");
    expect(first.status).toBe(2);
    expect(first.stderr).toMatch(/HU-7.*trivial/);
    expect(first.stderr).toMatch(/kj code --card HU-7 --brief/);
    expect(edit("src/a.js").status).toBe(0);
    expect(delegate()["HU-7"]).toMatchObject({ tier: "trivial", told: true, insisted: expect.any(Number) });
    expect(edit("src/b.js").status).toBe(0);
    expect(fs.readFileSync(calls(), "utf8").match(/hu tier/g)).toHaveLength(1);
  });

  it("lets a card planned without a tier through, and asks kj only once", () => {
    fakeKj("null");
    expect(edit("src/a.js").status).toBe(0);
    expect(edit("src/b.js").status).toBe(0);
    expect(fs.readFileSync(calls(), "utf8").match(/hu tier/g)).toHaveLength(1);
  });

  it("never stops kj code's own coder, nor a test file", () => {
    fakeKj('"standard"');
    expect(edit("src/a.js", { KJ_POLICY_ROLE: "coder" }).status).toBe(0);
    expect(edit("tests/a.test.js").status).toBe(0);
    expect(fs.existsSync(calls())).toBe(false);
  });

  it("lets the edit through when kj cannot answer, and records it", () => {
    fs.writeFileSync(path.join(bin, "kj"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    expect(edit("src/a.js").status).toBe(0);
    expect(delegate()["HU-7"]).toMatchObject({ tier: null, unknown: true });
  });
});
