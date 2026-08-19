// PL-C (KJC-TSK-0735) — kj policy add: el usuario habla, un agente traduce
// a una regla candidata, parsePolicy la VALIDA (vocabulario cerrado: lo
// intraducible se RECHAZA, jamás se inventa), se propone el diff del YAML
// y NO se escribe nada sin confirmación explícita (--yes).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { policyAddCommand } from "../../src/policy/add.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-poladd-"));
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\ninvariants:\n  - { id: loc, kind: diff-threshold, metric: net_lines_added, max: 200 }\n");
  process.chdir(dir);
});

const policyPath = () => path.join(dir, ".karajan", "policy.yml");
const run = ({ text = "el coder no toca los workflows", yes = false, fragment, logs = [] }) =>
  policyAddCommand({
    text,
    config: { projectDir: dir },
    flags: { yes },
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    deps: { translateFn: async () => fragment },
  });

const GOOD_FRAGMENT = 'roles:\n  coder:\n    write:\n      deny: [".github/workflows/**"]\n      enforcement: deny\n';

describe("kj policy add", () => {
  it("propone el diff y NO escribe sin --yes", async () => {
    const logs = [];
    expect(await run({ fragment: GOOD_FRAGMENT, logs })).toBe(0);
    expect(fs.readFileSync(policyPath(), "utf8")).not.toContain("workflows");
    const out = logs.join("\n");
    expect(out).toMatch(/\+.*workflows/);
    expect(out).toMatch(/--yes/);
  });

  it("con --yes escribe el merge y el resultado valida contra el motor", async () => {
    expect(await run({ fragment: GOOD_FRAGMENT, yes: true })).toBe(0);
    const written = fs.readFileSync(policyPath(), "utf8");
    expect(written).toContain(".github/workflows/**");
    expect(written).toContain("loc"); // el invariante previo sobrevive al merge
  });

  it("una regla fuera del vocabulario se RECHAZA nombrando el error, no se inventa", async () => {
    const logs = [];
    expect(await run({ fragment: "roles:\n  coder:\n    network: { deny: ['*'] }\n", yes: true, logs })).toBe(1);
    expect(fs.readFileSync(policyPath(), "utf8")).not.toContain("network");
    expect(logs.join("\n")).toMatch(/vocabulario/);
  });

  it("salida no-YAML del agente = rechazo limpio", async () => {
    expect(await run({ fragment: "esto no es: [yaml valido", yes: true })).toBe(1);
  });

  it("claves de nivel raiz fuera de roles/invariants se rechazan", async () => {
    expect(await run({ fragment: "hooks:\n  pre: rm -rf\n", yes: true })).toBe(1);
  });

  it("primer run sin .karajan/ crea el directorio y la policy (catch de codex)", async () => {
    fs.rmSync(path.join(dir, ".karajan"), { recursive: true, force: true });
    expect(await run({ fragment: GOOD_FRAGMENT, yes: true })).toBe(0);
    expect(fs.readFileSync(policyPath(), "utf8")).toContain(".github/workflows/**");
  });

  it("avisa cuando el rewrite perderia comentarios del YAML original", async () => {
    fs.writeFileSync(policyPath(), "# comentario importante\nversion: 1\n");
    const logs = [];
    await run({ fragment: GOOD_FRAGMENT, logs });
    expect(logs.join("\n")).toMatch(/comentario/i);
  });
});
