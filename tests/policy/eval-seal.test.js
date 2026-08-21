// GOV-F (KJC-TSK-0768) — las decisiones de tool-time entran en la MISMA
// cadena hash-encadenada que las de commit: el deny de `kj policy eval
// --strict` y el escape sellado por `kj policy seal`. Los allow de tool
// call NO se sellan (serían ruido, no evidencia).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { policyCommand } from "../../src/commands/policy.js";
import { verifyDecisionChain } from "@karajan-family/governance";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-evalseal-"));
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.env'], enforcement: deny }\n");
  process.chdir(dir);
});
const logger = () => {
  const lines = [];
  return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
};
const run = (action, flags) => policyCommand({ action, config: { projectDir: dir }, flags, logger: logger() });
const evalWrite = (file, strict = true) => run("eval", { role: "coder", tool: "Write", input: JSON.stringify({ file_path: file }), strict });
const log = () => {
  const p = path.join(dir, ".karajan", "policy-decisions.jsonl");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
};

describe("kj policy eval --strict sella el deny como decisión de tool-time", () => {
  it("deny con --strict: exit 2 y una entrada chokepoint=tool con regla, rol, tool y hash del input", async () => {
    expect(await evalWrite("src/.env")).toBe(2);
    const [rec] = log();
    expect(rec).toMatchObject({ decision: "deny", chokepoint: "tool", rule_ids: ["roles.coder.write.deny"], role: "coder", tool: "Write" });
    expect(rec.artifact_hash).toHaveLength(64);
    expect(rec.policy_hash).toHaveLength(64);
  });

  it("allow, y deny SIN --strict (diagnóstico humano), no sellan nada", async () => {
    expect(await evalWrite("src/a.js")).toBe(0);
    expect(await evalWrite("src/.env", false)).toBe(0);
    expect(log()).toHaveLength(0);
  });
});

describe("kj policy seal — el escape de tool-time deja rastro encadenado", () => {
  it("sella exempt chokepoint=tool con el escape, la tool y la identidad declarada del clon; la cadena verifica con los denies", async () => {
    fs.writeFileSync(path.join(dir, ".karajan", "identity.local.yml"), "gh_user: manufosela\ngit_email: m@example.invalid\n");
    expect(await evalWrite("src/.env")).toBe(2);
    expect(await run("seal", { escape: "KJ_ALLOW_POLICY", tool: "Bash" })).toBe(0);
    const recs = log();
    expect(recs).toHaveLength(2);
    expect(recs[1]).toMatchObject({ decision: "exempt", chokepoint: "tool", escape: "KJ_ALLOW_POLICY", tool: "Bash", who: { gh: "manufosela", git: "m@example.invalid", grade: "declarada" } });
    expect(verifyDecisionChain(fs.readFileSync(path.join(dir, ".karajan", "policy-decisions.jsonl"), "utf8").trim().split("\n"))).toMatchObject({ ok: true, length: 2 });
  });

  it("sin --escape es exit 1; sin identidad declarada sella con who=null (se dice lo que hay, no se inventa)", async () => {
    expect(await run("seal", { tool: "Bash" })).toBe(1);
    expect(await run("seal", { escape: "KJ_ALLOW_BOARD" })).toBe(0);
    expect(log().at(-1)).toMatchObject({ decision: "exempt", escape: "KJ_ALLOW_BOARD", tool: null, who: null });
  });
});
