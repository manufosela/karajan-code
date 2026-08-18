// KJC-TSK-0733 PL-A — policy as DATA (vocabulario cerrado, fail-loud al
// cargar), engine as code (puro, fs inyectado, deny-wins).

import { describe, it, expect } from "vitest";
import { loadPolicy, evalToolCall } from "../../src/policy/engine.js";

const load = (yamlText) =>
  loadPolicy({ projectDir: "/p", deps: { readFile: () => yamlText } });

const POLICY = `
version: 1
roles:
  coder:
    write:
      allow: ["src/**", "tests/**"]
      deny: ["**/*.env*", ".github/workflows/**"]
  reviewer:
    write: { allow: [] }
`;

describe("loadPolicy", () => {
  it("no policy file ⇒ embedded defaults — today's behavior, zero constraints", () => {
    const { policy, errors } = loadPolicy({ projectDir: "/p", deps: { readFile: () => null } });
    expect(errors).toEqual([]);
    expect(policy.version).toBe(1);
    expect(evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "anything.js" } }).decision).toBe("allow");
  });

  it("everything undeclarable fails LOUD at load — closed vocabulary, strict shapes, one version", () => {
    expect(load("version: 1\ninvariants:\n  - id: x\n    kind: quantum-vibes\n").errors.some((e) => e.includes("quantum-vibes"))).toBe(true);
    expect(load("version: 1\nroles:\n  coder:\n    teleport: {}\n").errors.some((e) => e.includes("teleport"))).toBe(true);
    // shell entra en la parte 2 CON su evaluación — hoy declararlo es error.
    expect(load("version: 1\nroles:\n  coder:\n    shell: {deny: ['curl *']}\n").errors.some((e) => e.includes("shell"))).toBe(true);
    expect(load("version: 7\n").errors.some((e) => e.includes("version"))).toBe(true);
    expect(load("version: 1\ninvariants: nope\n").errors.some((e) => e.includes("lista"))).toBe(true);
    expect(load('version: 1\nroles:\n  coder:\n    write: si\n').errors.some((e) => e.includes("objeto"))).toBe(true);
    expect(load("version: 1\nroles:\n  coder:\n    write: {allw: ['src/**']}\n").errors.some((e) => e.includes("allw"))).toBe(true);
  });

  it("an unreadable policy file is an ERROR, never silently 'no policy' (reviewer catch)", () => {
    const boom = () => { const e = new Error("denied"); e.code = "EACCES"; throw e; };
    const { errors } = loadPolicy({ projectDir: "/p", deps: { readFile: boom } });
    expect(errors.some((e) => e.includes("EACCES"))).toBe(true);
  });

  it("malformed shapes surface the error and never crash evaluation (reviewer catches)", () => {
    const { policy, errors } = load('version: 1\nroles:\n  coder:\n    write: {deny: "src/**"}\n');
    expect(errors.some((e) => e.includes("lista de strings"))).toBe(true);
    expect(evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "src/a.js" } }).decision).toBe("allow");
  });
});

describe("evalToolCall — write", () => {
  const { policy } = load(POLICY);

  it("deny WINS over allow (src/** allowed, .env denied inside it)", () => {
    const r = evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "src/.env.local" } });
    expect(r.decision).toBe("deny");
    expect(r.rule_id).toBe("roles.coder.write.deny");
    expect(r.reason).toContain("src/.env.local");
  });

  it("an allow-list makes everything OUTSIDE it a denial", () => {
    const r = evalToolCall(policy, { role: "coder", tool: "Edit", input: { file_path: "package.json" } });
    expect(r).toMatchObject({ decision: "deny", rule_id: "roles.coder.write.allow" });
    expect(evalToolCall(policy, { role: "coder", tool: "Edit", input: { file_path: "tests/a.test.js" } }).decision).toBe("allow");
  });

  it("an empty allow-list is a read-only role", () => {
    const r = evalToolCall(policy, { role: "reviewer", tool: "Write", input: { file_path: "src/a.js" } });
    expect(r.decision).toBe("deny");
  });

  it("unverifiable targets deny for constrained roles: missing, traversal, absolute-without-root (reviewer catches)", () => {
    expect(evalToolCall(policy, { role: "coder", tool: "Write", input: {} })).toMatchObject({ decision: "deny", rule_id: "roles.coder.write" });
    expect(evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "src/../.env" } }).decision).toBe("deny");
    expect(evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "../fuera/x.js" } }).decision).toBe("deny");
    expect(evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "/abs/x.js" } }).decision).toBe("deny");
    expect(evalToolCall(policy, { role: "tester", tool: "Write", input: {} }).decision).toBe("allow");
  });

  it("absolute paths WITH root are relativized and evaluated normally", () => {
    expect(evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "/repo/src/a.js" }, root: "/repo" }).decision).toBe("allow");
    expect(evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "/repo/src/.env" }, root: "/repo" }).decision).toBe("deny");
    expect(evalToolCall(policy, { role: "coder", tool: "Write", input: { file_path: "/otro/src/a.js" }, root: "/repo" }).decision).toBe("deny");
  });

  it("undeclared roles stay unconstrained; read-only tools are never writes", () => {
    expect(evalToolCall(policy, { role: "tester", tool: "Write", input: { file_path: "x" } }).decision).toBe("allow");
    expect(evalToolCall(policy, { role: "reviewer", tool: "Read", input: { file_path: "src/a.js" } }).decision).toBe("allow");
  });

  it("a DECLARED role using a tool outside the registry is denied — unknown is unverifiable (solomon ruling)", () => {
    expect(evalToolCall(policy, { role: "coder", tool: "TeleportFiles", input: {} })).toMatchObject({ decision: "deny", rule_id: "roles.coder.tools" });
    expect(evalToolCall(policy, { role: "tester", tool: "TeleportFiles", input: {} }).decision).toBe("allow");
    // Bash es conocida (su kind shell llega en la parte 2) — no se deniega.
    expect(evalToolCall(policy, { role: "coder", tool: "Bash", input: { command: "ls" } }).decision).toBe("allow");
  });
});

// (globToRegExp/matchesAny se prueban en tests/policy/glob.test.js — #1429.)
