// KJC-BUG-0161 / ADR 0009 — verifica por RECOMPUTACIÓN, o nada.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { renderCanonicalHook } from "../../src/harden/harden-engine.js";
import { PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";
import { canonicalHarnessBody } from "../../src/harden/sentinel-hooks.js";
import { liftSealedSupervisorViolations, verifiedSupervisorFiles } from "../../src/policy/supervisor-verify.js";

let repo;
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const generation = { profile: "standard", cmds: {}, baseBranch: "main", globalHooksDir: "$HOME/.git-hooks" };

const writeProvenance = (files, gen = generation) =>
  writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ kj_version: "9.9.9", generation: gen, files }));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-supverify-"));
  mkdirSync(join(repo, ".karajan", "hooks"), { recursive: true });
  mkdirSync(join(repo, ".karajan", "harness"), { recursive: true });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("verifiedSupervisorFiles (ADR 0009)", () => {
  it("a pure regeneration verifies: file == provenance == canonical render", () => {
    const canonical = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), canonical);
    writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(canonical) }]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.has(".karajan/hooks/pre-commit")).toBe(true);
  });

  it("one manual comma breaks it: hash matches provenance but not the canonical render", () => {
    const edited = `${renderCanonicalHook("pre-commit", generation)}# manual\n`;
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), edited);
    // provenance «honesta» con el hash del fichero editado — aun así NO
    // verifica: el render canónico no coincide.
    writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(edited) }]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.size).toBe(0);
  });

  it("a tampered file after sealing does not verify (hash mismatch)", () => {
    const canonical = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), `${canonical}\nrm -rf importante\n`);
    writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(canonical) }]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.size).toBe(0);
  });

  it("a hostile globalHooksDir in the provenance verifies NOTHING", () => {
    const gen = { ...generation, globalHooksDir: '$HOME/x"; rm -rf /; "' };
    const canonical = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), canonical);
    writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(canonical) }], gen);
    const res = verifiedSupervisorFiles({ projectDir: repo });
    expect(res.files.size).toBe(0);
    expect(res.reason).toMatch(/globalHooksDir/);
  });

  it("a sealed deletion verifies only while the file stays gone; escapes never verify", () => {
    writeProvenance([
      { file: ".karajan/hooks/post-merge", deleted: true },
      { file: "src/index.js", sha256: sha("x") },
      { file: ".karajan/hooks/../../evil.sh", sha256: sha("x") },
    ]);
    const res = verifiedSupervisorFiles({ projectDir: repo });
    expect(res.files.has(".karajan/hooks/post-merge")).toBe(true);
    expect(res.files.has("src/index.js")).toBe(false);
    expect(res.files.has(".karajan/hooks/../../evil.sh")).toBe(false);
  });
});

describe("liftSealedSupervisorViolations", () => {
  it("lifts only the sealed supervisor violations, keeps the rest", () => {
    const canonical = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), canonical);
    writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(canonical) }]);
    const violations = [
      { rule_id: "defaults.supervisor.write", file: ".karajan/hooks/pre-commit", reason: "x" },
      { rule_id: "defaults.supervisor.write", file: ".karajan/hooks/pre-push", reason: "x" },
      { rule_id: "loc-budget", reason: "y" },
    ];
    const res = liftSealedSupervisorViolations({ projectDir: repo, violations });
    expect(res.lifted).toBe(1);
    expect(res.violations.map((v) => v.file ?? v.rule_id)).toEqual([".karajan/hooks/pre-push", "loc-budget"]);
  });

  it("the provenance file itself lifts ONLY when the whole provenance verified", () => {
    const canonical = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), canonical);
    const provViolation = { rule_id: "defaults.supervisor.write", file: PROVENANCE_FILE, reason: "x" };
    // provenance completa y verificada → su propio diff se alza
    writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(canonical) }]);
    expect(liftSealedSupervisorViolations({ projectDir: repo, violations: [provViolation] }).lifted).toBe(1);
    // provenance con una entrada que NO verifica → la provenance sigue denegada
    writeProvenance([
      { file: ".karajan/hooks/pre-commit", sha256: sha(canonical) },
      { file: ".karajan/hooks/pre-push", sha256: sha("otra cosa") },
    ]);
    expect(liftSealedSupervisorViolations({ projectDir: repo, violations: [provViolation] }).lifted).toBe(0);
  });
});

// KJC-BUG-0211: desde KJC-BUG-0197 el sello cubre los guardias del supervisor,
// pero el levantamiento solo sabia verificar los hooks. Como `complete` exige
// que TODAS las entradas verifiquen, el primer sello de verdad no se pudo ni
// commitear: CI denegaba el diff de la propia provenance.
describe("los guardias del harness tambien verifican (KJC-BUG-0211)", () => {
  const guard = "pretooluse-sentinel.mjs";
  const path = `.karajan/harness/${guard}`;
  const writeGuard = (body) => writeFileSync(join(repo, ".karajan", "harness", guard), body);

  it("un guardia regenerado verifica: fichero == provenance == plantilla de kj", () => {
    const canonical = canonicalHarnessBody(guard);
    writeGuard(canonical);
    writeProvenance([{ file: path, sha256: sha(canonical) }]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.has(path)).toBe(true);
  });

  it("un guardia editado a mano NO verifica, aunque la provenance lleve su hash", () => {
    const edited = `${canonicalHarnessBody(guard)}// una linea mia\n`;
    writeGuard(edited);
    writeProvenance([{ file: path, sha256: sha(edited) }]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.size).toBe(0);
  });

  it("un guardia que kj no conoce no verifica, y una entrada borrada si cuando no existe", () => {
    writeProvenance([{ file: ".karajan/harness/inventado.mjs", sha256: sha("x") }]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.size).toBe(0);
    writeProvenance([{ file: ".karajan/harness/se-borro.mjs", deleted: true }]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.has(".karajan/harness/se-borro.mjs")).toBe(true);
  });

  it("con hooks y guardias verificados, la provenance se describe entera y su propio diff se alza", () => {
    const hook = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), hook);
    const canonical = canonicalHarnessBody(guard);
    writeGuard(canonical);
    writeProvenance([
      { file: ".karajan/hooks/pre-commit", sha256: sha(hook) },
      { file: path, sha256: sha(canonical) },
    ]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).complete).toBe(true);
    const violations = [{ rule_id: "defaults.supervisor.write", file: PROVENANCE_FILE }];
    expect(liftSealedSupervisorViolations({ projectDir: repo, violations }).violations).toEqual([]);
  });
});

// KJC-BUG-0212: los guardias estan en .gitignore, asi que en CI (o en cualquier
// clon que no sea la maquina que sello) NO existen. Exigir que todos verifiquen
// hacia imposible commitear el sello en ningun sitio menos uno.
describe("lo que aqui no se puede comprobar no es un fallo (KJC-BUG-0212)", () => {
  const guard = "pretooluse-sentinel.mjs";
  const path = `.karajan/harness/${guard}`;

  const sealWith = (guardOnDisk) => {
    const hook = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), hook);
    const canonical = canonicalHarnessBody(guard);
    if (guardOnDisk !== null) writeFileSync(join(repo, ".karajan", "harness", guard), guardOnDisk);
    writeProvenance([
      { file: ".karajan/hooks/pre-commit", sha256: sha(hook) },
      { file: path, sha256: sha(canonical) },
    ]);
  };

  it("el caso de CI: sin guardias en el checkout, el sello sigue siendo commiteable", () => {
    sealWith(null);
    const res = verifiedSupervisorFiles({ projectDir: repo });
    expect(res.complete).toBe(true);
    expect(res.files.has(path)).toBe(false); // no se ha verificado: no estaba
    expect(res.unjudgeable.has(path)).toBe(true);
    const lift = liftSealedSupervisorViolations({
      projectDir: repo,
      violations: [{ rule_id: "defaults.supervisor.write", file: PROVENANCE_FILE }],
    });
    expect(lift.violations).toEqual([]);
    expect(lift.note).toMatch(/no se han podido comprobar/);
  });

  it("un guardia PRESENTE y editado a mano sigue denegando: ahi es donde importa", () => {
    sealWith(`${canonicalHarnessBody(guard)}// una linea mia\n`);
    const res = verifiedSupervisorFiles({ projectDir: repo });
    expect(res.complete).toBe(false);
    expect(res.unjudgeable.size).toBe(0); // estaba, se juzgo, fallo
  });

  it("un hook ausente si rompe: los hooks viajan con el repo", () => {
    const hook = renderCanonicalHook("pre-commit", generation);
    writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(hook) }]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).complete).toBe(false);
  });

  it("ausente NO es cheque en blanco: el hash tiene que ser el de un guardia que kj conoce", () => {
    // Catch de la review: si no, una provenance forjada cuela entradas
    // ausentes con cualquier hash y se alza a si misma con una sola valida.
    const hook = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), hook);
    for (const forjada of [
      { file: path, sha256: sha("lo que me convenga") },
      { file: ".karajan/harness/inventado.mjs", sha256: sha("x") },
      { file: path },
    ]) {
      writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(hook) }, forjada]);
      expect(verifiedSupervisorFiles({ projectDir: repo }).complete, JSON.stringify(forjada)).toBe(false);
    }
  });

  it("una provenance sin NADA verificado no se alza a si misma", () => {
    writeProvenance([{ file: path, sha256: sha("x") }]);
    expect(verifiedSupervisorFiles({ projectDir: repo }).complete).toBe(false);
  });
});

describe("el release check juzga lo versionado (KJC-BUG-0259, decision del usuario: opcion A)", () => {
  const guard = "pretooluse-sentinel.mjs";
  const path = `.karajan/harness/${guard}`;

  it("kj avanzo tras el sello: la review (completo) falla, la historia (trackedOnly) se alza", () => {
    // Sellado esta manana con unas plantillas que kj ya no escribe.
    const hook = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), hook);
    const older = "// the guard as kj wrote it this morning\n";
    writeFileSync(join(repo, ".karajan", "harness", guard), older);
    writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(hook) }, { file: path, sha256: sha(older) }]);
    const violations = [{ rule_id: "defaults.supervisor.write", file: PROVENANCE_FILE }];
    expect(verifiedSupervisorFiles({ projectDir: repo }).complete).toBe(false);
    expect(liftSealedSupervisorViolations({ projectDir: repo, violations }).violations).toHaveLength(1);
    expect(verifiedSupervisorFiles({ projectDir: repo, trackedOnly: true }).complete).toBe(true);
    expect(liftSealedSupervisorViolations({ projectDir: repo, violations, trackedOnly: true }).violations).toEqual([]);
  });

  it("lo versionado sigue mandando: un hook editado a mano no se alza ni juzgando solo lo versionado", () => {
    const hook = renderCanonicalHook("pre-commit", generation);
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), `${hook}# mio\n`);
    writeProvenance([{ file: ".karajan/hooks/pre-commit", sha256: sha(`${hook}# mio\n`) }]);
    expect(verifiedSupervisorFiles({ projectDir: repo, trackedOnly: true }).complete).toBe(false);
  });
});
