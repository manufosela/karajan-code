// HU-4897 (KJC-BUG-0661): only a person lifts a gate. `kj policy grant` records a standing
// exception that lifts a rule, so it is a human act (ADR 0009, ADR 0015, ADR 0018): refused to an
// agent session, confirmed at the person's terminal, and signed by the phone at `critical`, as
// loosening a gate is. A refused grant records nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { policyCommand } from "../../src/commands/policy.js";
import { CRITICAL_ACTS, HUMAN_ACTS } from "../../src/harden/human-act.js";
import { setNormalLevel, setSignedLevel } from "../_fixtures/set-normal-level.js";

const DENY_POLICY = "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny }\n";
const RULE = "roles.coder.write.deny";
const FAR = "2099-01-01T00:00:00Z";

let dir;
let home;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-grant-proj-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-grant-home-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

const bash = { readProc: () => ({ ppid: 1, cmd: "bash" }) };
const human = { env: {}, tty: true, ancestry: bash, confirm: (nonce) => nonce, phone: { enrolled: () => false } };
const store = () => path.join(dir, ".karajan", "policy-exceptions.jsonl");
const grant = (deps, logs = []) => policyCommand({
  action: "grant", config: { projectDir: dir },
  flags: { rule: RULE, until: FAR, reason: "the person lifts it" },
  logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  deps: { readFile: () => DENY_POLICY, home, ...deps },
});

describe("kj policy grant is a human act (HU-4897)", () => {
  it("is in the catalog, implemented by src/commands/policy.js, and critical like loosening a gate", () => {
    expect(HUMAN_ACTS["policy-grant"]).toMatchObject({ module: "src/commands/policy.js" });
    expect(HUMAN_ACTS["policy-grant"].label).toMatch(/kj policy grant/);
    expect(CRITICAL_ACTS.has("policy-grant")).toBe(true);
  });

  it("an agent session is refused, says it is a human act, and records nothing", async () => {
    setNormalLevel(dir);
    const logs = [];
    const code = await grant({ ...human, env: { CLAUDECODE: "1" } }, logs);
    expect(code).not.toBe(0);
    expect(logs.join("\n")).toMatch(/kj policy grant.*acto humano/);
    expect(fs.existsSync(store())).toBe(false);
  });

  it("a process that descends from an agent is refused and records nothing", async () => {
    setNormalLevel(dir);
    const ancestry = { readProc: (p) => (p === 4242 ? { ppid: 1, cmd: "codex" } : { ppid: 4242, cmd: "node kj" }) };
    const code = await grant({ ...human, ancestry });
    expect(code).not.toBe(0);
    expect(fs.existsSync(store())).toBe(false);
  });

  it("a wrong code at the terminal is refused and records nothing", async () => {
    setNormalLevel(dir);
    const code = await grant({ ...human, confirm: () => "wrong" });
    expect(code).not.toBe(0);
    expect(fs.existsSync(store())).toBe(false);
  });

  it("at critical with no phone to sign it, the grant is refused and records nothing", async () => {
    setSignedLevel(dir, "critical");
    const logs = [];
    const code = await grant(human, logs);
    expect(code).not.toBe(0);
    expect(logs.join("\n")).toMatch(/móvil/);
    expect(fs.existsSync(store())).toBe(false);
  });

  it("the person at their terminal records the exception", async () => {
    setNormalLevel(dir);
    const code = await grant(human);
    expect(code).toBe(0);
    const rec = JSON.parse(fs.readFileSync(store(), "utf8").trim());
    expect(rec).toMatchObject({ rule_id: RULE, scopeKind: "permanente", expiresAt: FAR });
  });
});
