// GOV-C2 (KJC-TSK-0749) — anclaje temporal sin blockchain: kj policy anchor
// verifica la cadena ENTERA y sella su head-hash en un fichero trackeable
// por git — reescribir el log de ayer exige reescribir el repo de ayer.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { policyCommand } from "../../src/commands/policy.js";
import { recordGateDecision } from "../../src/policy/decisions.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-anchor-"));
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  process.chdir(dir);
});

const logger = () => {
  const out = { info: [], error: [] };
  return { out, log: { info: (m) => out.info.push(m), error: (m) => out.error.push(m) } };
};
const anchorPath = () => path.join(dir, ".karajan", "policy-anchor.json");
const run = (log) => policyCommand({ action: "anchor", config: { projectDir: dir }, flags: {}, logger: log });

describe("kj policy anchor", () => {
  it("verifica la cadena y sella head, length y ts en un json trackeable", async () => {
    recordGateDecision(dir, { decision: "deny", rule_ids: ["r1"] });
    recordGateDecision(dir, { decision: "allow", chokepoint: "commit" });
    const { out, log } = logger();
    expect(await run(log)).toBe(0);
    const anchor = JSON.parse(fs.readFileSync(anchorPath(), "utf8"));
    expect(anchor.length).toBe(2);
    expect(anchor.head).toHaveLength(64);
    expect(anchor.ts).toBeTruthy();
    expect(out.info.join("\n")).toMatch(/commit/i);
  });

  it("cadena manipulada = exit 1 gritando y SIN sellar", async () => {
    recordGateDecision(dir, { decision: "deny", rule_ids: ["r1"] });
    recordGateDecision(dir, { decision: "allow" });
    const p = path.join(dir, ".karajan", "policy-decisions.jsonl");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace('"deny"', '"allow"'));
    const { out, log } = logger();
    expect(await run(log)).toBe(1);
    expect(fs.existsSync(anchorPath())).toBe(false);
    expect(out.error.join("\n")).toMatch(/cadena|rota/i);
  });

  it("log truncado tras un anchor previo se detecta (length retrocede) y no se re-sella", async () => {
    recordGateDecision(dir, { decision: "deny", rule_ids: ["r1"] });
    recordGateDecision(dir, { decision: "allow" });
    expect(await run(logger().log)).toBe(0);
    const p = path.join(dir, ".karajan", "policy-decisions.jsonl");
    const first = fs.readFileSync(p, "utf8").split("\n")[0];
    fs.writeFileSync(p, `${first}\n`); // borra la segunda entrada: cadena VÁLIDA pero más corta
    const { out, log } = logger();
    expect(await run(log)).toBe(1);
    expect(out.error.join("\n")).toMatch(/retroced|anchor/i);
  });

  it("sin log que anclar (ausente o vacio) lo dice y no inventa un anchor", async () => {
    const { out, log } = logger();
    expect(await run(log)).toBe(0);
    expect(fs.existsSync(anchorPath())).toBe(false);
    expect(out.info.join("\n")).toMatch(/sin decisiones/i);
    fs.writeFileSync(path.join(dir, ".karajan", "policy-decisions.jsonl"), "\n  \n"); // vacio = lo mismo (catch de codex)
    expect(await run(logger().log)).toBe(0);
    expect(fs.existsSync(anchorPath())).toBe(false);
  });
});
