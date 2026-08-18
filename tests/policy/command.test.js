// PL-A 3b (KJC-TSK-0733) — `kj policy` en modo warn: eval con contrato de
// adaptador (--strict ⇒ exit 2 en deny) y check del staged que AVISA sin
// bloquear; un policy.yml inválido es exit 1, nunca un pase.
import { describe, it, expect } from "vitest";
import { policyCommand } from "../../src/commands/policy.js";

const logger = () => {
  const lines = [];
  return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
};

const POLICY = `
version: 1
roles:
  coder:
    write: { deny: ["**/*.env*"] }
invariants:
  - id: loc-budget
    kind: diff-threshold
    metric: net_lines_added
    max: 200
`;
const deps = (extra = {}) => ({ readFile: () => POLICY, ...extra });

describe("kj policy eval", () => {
  it("imprime el veredicto estructurado; --strict convierte deny en exit 2", async () => {
    const log = logger();
    const code = await policyCommand({
      action: "eval", config: { projectDir: "/p" }, logger: log,
      flags: { role: "coder", tool: "Write", input: '{"file_path":"src/.env"}', strict: true },
      deps: deps(),
    });
    expect(code).toBe(2);
    expect(JSON.parse(log.lines.at(-1))).toMatchObject({ decision: "deny", rule_id: "roles.coder.write.deny" });
    expect(await policyCommand({
      action: "eval", config: { projectDir: "/p" }, logger: logger(),
      flags: { role: "coder", tool: "Write", input: '{"file_path":"src/a.js"}', strict: true },
      deps: deps(),
    })).toBe(0);
  });

  it("--input no-JSON es exit 1 con motivo", async () => {
    const log = logger();
    expect(await policyCommand({ action: "eval", logger: log, flags: { tool: "Write", input: "{rota" }, deps: deps() })).toBe(1);
    expect(log.lines.join("\n")).toContain("JSON");
  });
});

describe("kj policy check --staged (warn)", () => {
  const gitFn = async (args) =>
    args.includes("--name-only") ? "src/ok.js\nsrc/.env.local\n" : "250\t0\tsrc/ok.js\n";

  it("avisa las violaciones con rule_id y NUNCA bloquea en PL-A", async () => {
    const log = logger();
    const code = await policyCommand({ action: "check", config: { projectDir: "/p" }, logger: log, flags: {}, deps: deps({ gitFn }) });
    expect(code).toBe(0);
    const out = log.lines.join("\n");
    expect(out).toContain("roles.coder.write.deny");
    expect(out).toContain("loc-budget");
    expect(out).toContain("warn");
  });

  it("--json emite {mode, violations} parseable; limpio dice limpio", async () => {
    const log = logger();
    await policyCommand({ action: "check", config: { projectDir: "/p" }, logger: log, flags: { json: true }, deps: deps({ gitFn }) });
    const parsed = JSON.parse(log.lines.at(-1));
    expect(parsed.mode).toBe("warn");
    expect(parsed.violations.length).toBeGreaterThan(0);

    const clean = logger();
    await policyCommand({ action: "check", config: { projectDir: "/p" }, logger: clean, flags: {}, deps: deps({ gitFn: async (a) => (a.includes("--name-only") ? "src/a.js\n" : "5\t0\tsrc/a.js\n") }) });
    expect(clean.lines.join("\n")).toContain("limpio");
  });

  it("un policy.yml inválido es exit 1 — jamás un pase silencioso", async () => {
    const log = logger();
    const code = await policyCommand({ action: "check", logger: log, flags: {}, deps: { readFile: () => "version: 9\n" } });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("version");
  });
});
