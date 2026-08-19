// PL-C (KJC-TSK-0735) — el tier C del ADR 0001: kj policy check gana
// --range (en CI no hay staged: se evalúa base...head) y --strict (exit 2
// nombrando la regla si hay violación con enforcement=deny; warn sigue
// informando sin bloquear). El workflow kj:managed solo se siembra cuando
// el proyecto DECLARA policy.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { policyCommand } from "../../src/commands/policy.js";
import { installWorkflows } from "../../src/harden/workflow-engine.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-polci-"));
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  process.chdir(dir);
});

const writePolicy = (yaml) => fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), yaml);
const DENY_POLICY = "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny }\n";

// gitFn inyectado: registra los args con los que check pide el diff.
const gitSpy = (files, numstat) => {
  const calls = [];
  const fn = async (args) => {
    calls.push(args.join(" "));
    if (args.includes("--name-only")) return files.join("\n");
    return numstat;
  };
  return { calls, fn };
};

describe("kj policy check --range (tier C)", () => {
  it("evalua base...head en vez del staged cuando hay --range", async () => {
    writePolicy(DENY_POLICY);
    const { calls, fn } = gitSpy(["src/ok.js"], "1\t0\tsrc/ok.js");
    const code = await policyCommand({
      action: "check", config: { projectDir: dir },
      flags: { range: "origin/main...HEAD" },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      deps: { gitFn: fn },
    });
    expect(code).toBe(0);
    expect(calls.some((c) => c.includes("origin/main...HEAD"))).toBe(true);
    expect(calls.some((c) => c.includes("--cached"))).toBe(false);
  });
});

describe("kj policy check --strict", () => {
  it("violacion deny = exit 2 nombrando la regla; sin --strict sigue siendo warn", async () => {
    writePolicy(DENY_POLICY);
    const { fn } = gitSpy(["prod.secret"], "3\t0\tprod.secret");
    const out = [];
    const logger = { info: (m) => out.push(m), warn: (m) => out.push(m), error: (m) => out.push(m) };
    expect(await policyCommand({ action: "check", config: { projectDir: dir }, flags: {}, logger, deps: { gitFn: fn } })).toBe(0);
    expect(await policyCommand({ action: "check", config: { projectDir: dir }, flags: { strict: true }, logger, deps: { gitFn: fn } })).toBe(2);
    expect(out.join("\n")).toMatch(/roles\.coder\.write\.deny/);
  });

  it("violacion warn NO cierra ni con --strict — solo enforcement=deny bloquea el merge", async () => {
    writePolicy("version: 1\ninvariants:\n  - { id: loc, kind: diff-threshold, metric: net_lines_added, max: 10 }\n");
    const { fn } = gitSpy(["src/ok.js"], "99\t0\tsrc/ok.js");
    const code = await policyCommand({
      action: "check", config: { projectDir: dir }, flags: { strict: true },
      logger: { info: () => {}, warn: () => {}, error: () => {} }, deps: { gitFn: fn },
    });
    expect(code).toBe(0);
  });
});

describe("workflow kj-policy (kj:managed)", () => {
  it("se siembra SOLO cuando el proyecto declara policy.yml", () => {
    fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    let res = installWorkflows({ projectDir: dir });
    expect(res.workflows.some((w) => w.file.includes("kj-policy.yml"))).toBe(false);
    writePolicy(DENY_POLICY);
    res = installWorkflows({ projectDir: dir });
    const wf = res.workflows.find((w) => w.file.includes("kj-policy.yml"));
    expect(wf?.action).toBe("inserted");
    const body = fs.readFileSync(path.join(dir, ".github", "workflows", "kj-policy.yml"), "utf8");
    expect(body).toContain("kj:managed:wf-policy");
    expect(body).toMatch(/policy check .*--range.*--strict/);
  });
});
