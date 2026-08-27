// CLM-B, wiring (KJC-TSK-0802) — the Stop hook crosses the final message's hard
// data against the turn's outputs by spawning `kj claims gate`. The hook carries
// NO policy: kj reads method_gates.claims and decides. These tests drive the
// GENERATED stop.mjs with the REAL kj binary — after KJC-BUG-0146 taught us
// twice that a test on the wrong function proves nothing about the wiring.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, stop, home;
const env = () => ({ ...process.env, KJ_ALLOW_IDENTITY: "1", KARAJAN_HOME: home });
const endTurn = (transcript) => spawnSync("node", [stop], {
  input: JSON.stringify({ session_id: "s1", ...(transcript ? { transcript_path: transcript } : {}) }),
  encoding: "utf8", cwd: dir, env: env(), timeout: 120_000,
});

// The real case of the ADR: the board answered an empty list, the AI says "4 cards".
const transcriptWith = (finalText) => {
  const p = path.join(dir, "session.jsonl");
  const rows = [
    { type: "user", message: { role: "user", content: "cuantas cards quedan?" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "list" } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "list_cards status=To Validate → []  (0 cards)" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: finalText }] } },
  ];
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n"));
  return p;
};
const configure = (mode) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "kj.config.yml"), `method_gates:\n  claims: ${mode}\n`);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-claims-gate-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-home-"));
  fs.writeFileSync(path.join(home, "kj.config.yml"), "base_branch: main\n");
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  stop = path.join(dir, ".karajan", "harness", "stop.mjs");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

describe("stop gate × claims (real kj binary)", () => {
  it("block mode: a datum denied by its own source refuses to end the turn, and says how to inspect it", () => {
    configure("block");
    const r = endTurn(transcriptWith("Quedan 4 cards esperando validación."));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/DESMENTIDO/);
    expect(r.stderr).toMatch(/kj claims check --transcript/);
  }, 120_000);

  it("block mode: backed data ends the turn normally", () => {
    configure("block");
    const r = endTurn(transcriptWith("El board devolvió 0 cards."));
    expect(r.status).toBe(0);
  }, 120_000);

  it("warn mode: the same denied datum informs but never blocks — the ADR's default posture", () => {
    configure("warn");
    const r = endTurn(transcriptWith("Quedan 4 cards esperando validación."));
    expect(r.status).toBe(0);
    const last = r.stdout.trim().split("\n").at(-1);
    expect(last ? JSON.parse(last).systemMessage : "").toMatch(/kj claims/);
  }, 120_000);

  it("without adoption (default off) the gate does not exist: same transcript, silent green", () => {
    const r = endTurn(transcriptWith("Quedan 4 cards esperando validación."));
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/claims/);
  }, 120_000);

  it("no transcript in the hook input: nothing is checked, nothing breaks", () => {
    configure("block");
    expect(endTurn(null).status).toBe(0);
  }, 120_000);
});
