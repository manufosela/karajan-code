// KJC-TSK-1651 (ADR 0059): the Stop hook holds the turn while the session's cards wait, through
// `kj continuation gate`, and steps aside after 3 holds in a row. Driven with the GENERATED
// stop.mjs and the REAL kj binary, as the claims gate tests do.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

let dir, stop, home, bin;
const KJ_BIN = path.resolve("bin/kj.js");
const env = () => ({ ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, KARAJAN_HOME: home, KJ_NO_UPDATE_CHECK: "1" });
const endTurn = (transcript) => spawnSync("node", [stop], {
  input: JSON.stringify({ session_id: "s1", transcript_path: transcript }),
  encoding: "utf8", cwd: dir, env: env(), timeout: 120_000,
});
const transcriptWith = (cardLine, finalText) => {
  const p = path.join(dir, "session.jsonl");
  const rows = [
    { type: "user", message: { role: "user", content: "haz las HUs" } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: cardLine }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: finalText }] } },
  ];
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n"));
  return p;
};
const configure = (mode) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "kj.config.yml"), `method_gates:\n  continuation: ${mode}\n`);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-continuation-gate-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-home-"));
  bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\nexec node "${KJ_BIN}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(home, "kj.config.yml"), "base_branch: main\n");
  fs.writeFileSync(path.join(home, "update-check.json"), JSON.stringify({ checkedAt: Date.now(), latest: "999.0.0" }));
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  placeGuardCopies(dir);
  stop = path.join(dir, ".karajan", "harness", "stop.mjs");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

describe("stop gate × continuation (real kj binary)", () => {
  const waiting = () => transcriptWith("✓ HU created: HU-7 (pending) in the shared board", "Llevamos mucho, lo dejamos aquí.");

  it("holds a turn that stops with a session card pending, naming it", () => {
    const r = endTurn(waiting());
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/HU-7/);
  }, 120_000);

  it("ends the turn when the session's cards are done, or the gate is off", () => {
    expect(endTurn(transcriptWith("✓ HU-7 → done", "Hecho.")).status).toBe(0);
    configure("off");
    expect(endTurn(waiting()).status).toBe(0);
  }, 120_000);

  it("steps aside after 3 holds in a row and says so", () => {
    const t = waiting();
    for (let i = 0; i < 3; i += 1) expect(endTurn(t).status).toBe(2);
    const fourth = endTurn(t);
    expect(fourth.status).toBe(0);
    expect(fourth.stderr).toMatch(/continuation.*3/);
  }, 240_000);
});
