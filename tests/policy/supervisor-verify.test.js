// KJC-BUG-0161 / ADR 0009 — verifica por RECOMPUTACIÓN, o nada.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { renderCanonicalHook } from "../../src/harden/harden-engine.js";
import { PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";
import { liftSealedSupervisorViolations, verifiedSupervisorFiles } from "../../src/policy/supervisor-verify.js";

let repo;
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const generation = { profile: "standard", cmds: {}, baseBranch: "main", globalHooksDir: "$HOME/.git-hooks" };

const writeProvenance = (files, gen = generation) =>
  writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ kj_version: "9.9.9", generation: gen, files }));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-supverify-"));
  mkdirSync(join(repo, ".karajan", "hooks"), { recursive: true });
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
