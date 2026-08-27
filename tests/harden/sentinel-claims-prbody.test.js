// CLM-C, wiring (KJC-TSK-0803) — before `gh pr create/edit --body-file` runs,
// the PreToolUse hook crosses the BODY FILE's data against the turn's outputs
// via `kj claims gate --file`. The hook carries no policy: kj reads
// method_gates.claims. Driven against the GENERATED pretooluse-sentinel.mjs
// with the real kj binary — the wiring is what these tests prove.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, pre, home, bin;
// Same shim as the Stop-gate suite: the hook spawns `kj` from PATH and fails
// OPEN without it; CI has no global kj, so point a shim at this checkout.
const KJ_BIN = path.resolve("bin/kj.js");
const env = () => ({ ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, KJ_ALLOW_IDENTITY: "1", KARAJAN_HOME: home });
const runPre = (command, transcript) => spawnSync("node", [pre], {
  input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command }, ...(transcript ? { transcript_path: transcript } : {}) }),
  encoding: "utf8", cwd: dir, env: env(), timeout: 120_000,
});

// The ADR's canonical case: the board answered an empty list.
const transcriptFixture = () => {
  const p = path.join(dir, "session.jsonl");
  const rows = [
    { type: "user", message: { role: "user", content: "cierra la tarea" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "list" } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "list_cards status=To Validate → []  (0 cards)" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hecho." }] } },
  ];
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n"));
  return p;
};
const bodyWith = (text) => {
  const p = path.join(dir, "pr.md");
  fs.writeFileSync(p, text);
  return p;
};
const configure = (mode) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "kj.config.yml"), `method_gates:\n  claims: ${mode}\n`);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-claims-prbody-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-home-"));
  bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\nexec node "${KJ_BIN}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(home, "kj.config.yml"), "base_branch: main\n");
  execSync("git init -q -b main && git config user.email a@b.c && git config user.name t && git commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0042-demo", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

describe("pretool gate × claims on PR bodies (real kj binary)", () => {
  it("block mode: a denied datum in the body file blocks the PR and says how to inspect it", () => {
    configure("block");
    const body = bodyWith("Quedan 4 cards esperando validación.");
    const r = runPre(`gh pr create --title "x" --body-file ${body}`, transcriptFixture());
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/DESMENTIDO/);
    expect(r.stderr).toMatch(/kj claims check --transcript .+ --file/);
  }, 120_000);

  it("block mode: a body backed by the outputs lets the PR through", () => {
    configure("block");
    const body = bodyWith("El board devolvió 0 cards.");
    const r = runPre(`gh pr edit 7 --body-file ${body}`, transcriptFixture());
    expect(r.status).toBe(0);
  }, 120_000);

  it("without adoption (default off) the gate does not exist: same denied body, silent green", () => {
    const body = bodyWith("Quedan 4 cards esperando validación.");
    const r = runPre(`gh pr create --title "x" --body-file ${body}`, transcriptFixture());
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/claims/);
  }, 120_000);

  it("no transcript in the hook input: nothing to cross against, nothing breaks", () => {
    configure("block");
    const body = bodyWith("Quedan 4 cards esperando validación.");
    expect(runPre(`gh pr create --title "x" --body-file ${body}`, null).status).toBe(0);
  }, 120_000);

  it("an inline --body is out of this gate's reach (the Stop gate still covers the turn)", () => {
    configure("block");
    const r = runPre('gh pr create --title "x" --body "Quedan 4 cards."', transcriptFixture());
    expect(r.status).toBe(0);
  }, 120_000);
});
