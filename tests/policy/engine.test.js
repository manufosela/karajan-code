// KJC-TSK-0733 PL-A — policy as DATA (vocabulario cerrado, fail-loud al
// cargar), engine as code (puro, fs inyectado, deny-wins).

import { describe, it, expect } from "vitest";
import { checkStagedDiff, evalToolCall, loadPolicy } from "../../src/policy/engine.js";

const load = (yamlText) =>
  loadPolicy({ projectDir: "/p", deps: { readFile: () => yamlText } });

const POLICY = `
version: 1
roles:
  coder:
    write:
      allow: ["src/**", "tests/**"]
      deny: ["**/*.env*", ".github/workflows/**"]
    shell:
      deny: ["git add -A*", "git push*", "curl *"]
  reviewer:
    write: { allow: [] }
invariants:
  - id: loc-budget
    kind: diff-threshold
    metric: net_lines_added
    max: 200
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
    // Un invariant con kind válido pero forma incompleta o max no-finito falla.
    expect(load("version: 1\ninvariants:\n  - id: x\n    kind: diff-threshold\n").errors.some((e) => e.includes("max"))).toBe(true);
    expect(load("version: 1\ninvariants:\n  - id: x\n    kind: diff-threshold\n    metric: net_lines_added\n    max: .nan\n").errors.some((e) => e.includes("max"))).toBe(true);
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
  });
});

describe("evalToolCall — shell (por segmento)", () => {
  const { policy } = load(POLICY);
  const bash = (command, role = "coder") => evalToolCall(policy, { role, tool: "Bash", input: { command } });

  it("deniega si CUALQUIER segmento casa un patrón denegado (el clásico git add -A)", () => {
    expect(bash("npx vitest run && git add -A")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell.deny" });
    expect(bash("git add -A")).toMatchObject({ decision: "deny" });
  });

  it("comandos limpios pasan; roles sin shell declarado quedan libres; comando ausente deniega", () => {
    expect(bash("npx vitest run").decision).toBe("allow");
    expect(bash("git push", "tester").decision).toBe("allow");
    expect(bash(undefined)).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell" });
  });

  it("el quoting se canonicaliza y la evasión por comillas/escapes/cabecera-variable deniega (reviewer catch)", () => {
    expect(bash('"git" push origin')).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell.deny" });
    expect(bash("git 'add' -A")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell.deny" });
    expect(bash("git\\ push x")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell" });
    expect(bash("$G push")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell" });
    // $ expandible en CUALQUIER posición = opaco; entre comillas simples es literal.
    expect(bash("git push $REMOTE")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell" });
    expect(bash("git commit -m 'precio en $'").decision).toBe("allow");
    // Comillas legítimas en argumentos no molestan al prefijo, y un ';'
    // DENTRO de comillas no es separador (reviewer catch).
    expect(bash('git commit -m "release 4.17"').decision).toBe("allow");
    expect(bash('git commit -m "a;b && c"').decision).toBe("allow");
  });

  it("launchers y asignaciones se pelan: el patrón caza el subcomando real (reviewer catch)", () => {
    expect(bash("sudo git push origin main")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell.deny" });
    expect(bash("env FOO=1 git add -A")).toMatchObject({ decision: "deny" });
    expect(bash("NODE_ENV=test nohup curl http://x")).toMatchObject({ decision: "deny" });
    expect(bash("FOO=1 npx vitest run").decision).toBe("allow");
    // Redirecciones y backgrounding no están modelados ⇒ opacos.
    expect(bash("git status > out.txt")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell" });
    expect(bash("npx vitest run & npx vitest run")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell" });
    expect(bash("git commit -m 'a > b'").decision).toBe("allow");
    // Asignaciones que cambian QUÉ ejecutable resuelve = opacas.
    expect(bash("PATH=/tmp/evil git status")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell" });
    expect(bash("FOO=$BAR git status")).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell" });
  });

  it("envolturas, sustitución y eval son texto opaco ⇒ deny (reviewer catch, clase del Sentinel)", () => {
    for (const evil of ['sh -c "git add -A"', "bash -lc 'git push'", "echo $(git push)", "eval git push", "xargs rm < lista", "diff <(git push) x", "tee >(git push)"]) {
      expect(bash(evil)).toMatchObject({ decision: "deny", rule_id: "roles.coder.shell" });
    }
  });

  it("con allow-list, TODO segmento debe casar", () => {
    const { policy: p2 } = load('version: 1\nroles:\n  ci:\n    shell: {allow: ["npm *", "npx *"]}\n');
    expect(evalToolCall(p2, { role: "ci", tool: "Bash", input: { command: "npm test && npx vitest run" } }).decision).toBe("allow");
    expect(evalToolCall(p2, { role: "ci", tool: "Bash", input: { command: "npm test && rm -rf x" } })).toMatchObject({ decision: "deny", rule_id: "roles.ci.shell.allow" });
  });
});

describe("checkStagedDiff — el gate del resultado", () => {
  const { policy } = load(POLICY);

  it("flagea ficheros write-deny del diff y el presupuesto de líneas", () => {
    const v = checkStagedDiff(policy, { role: "coder", files: ["src/ok.js", ".github/workflows/x.yml"], netLinesAdded: 250 });
    expect(v.some((x) => x.rule_id === "roles.coder.write.deny" && x.file === ".github/workflows/x.yml")).toBe(true);
    expect(v.some((x) => x.rule_id === "loc-budget" && x.reason.includes("250"))).toBe(true);
  });

  it("un diff limpio devuelve cero violaciones", () => {
    expect(checkStagedDiff(policy, { role: "coder", files: ["src/a.js"], netLinesAdded: 10 })).toEqual([]);
  });

  it("métrica ausente con invariante declarado = violación, no pase silencioso (reviewer catch)", () => {
    const v = checkStagedDiff(policy, { role: "coder", files: [] });
    expect(v.some((x) => x.rule_id === "loc-budget" && x.reason.includes("no disponible"))).toBe(true);
  });
});

// (globToRegExp/matchesAny se prueban en tests/governance/glob.test.js — #1429.)
