/**
 * E2E #10 — CLI surface (no LLM required).
 *
 * Spawns the real `kj` binary and asserts the contract every user
 * touches first: --version, --help, unknown commands, basic flag
 * parsing. These regressions silently break onboarding so the e2e
 * net pins them.
 */

import { describe, expect, it } from "vitest";
import { runKj } from "./helpers/spawn-kj.js";
import { makeTmpProject } from "./helpers/tmp-project.js";

describe("e2e/10 — CLI surface", () => {
  it("kj --version prints a semver string and exits 0", () => {
    const proj = makeTmpProject();
    try {
      const r = runKj(["--version"], { cwd: proj.projectDir });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    } finally { proj.cleanup(); }
  });

  it("kj --help lists the core commands + the advanced pointer, exits 0", () => {
    const proj = makeTmpProject();
    try {
      const r = runKj(["--help"], { cwd: proj.projectDir });
      expect(r.exitCode).toBe(0);
      // KJC-TSK-0582: --help shows only the core basics + a pointer to
      // `kj advanced`. The advanced commands no longer clutter this listing.
      for (const cmd of ["init", "run", "plan", "doctor", "harden", "advanced"]) {
        expect(r.stdout, `'${cmd}' missing from --help`).toContain(cmd);
      }
    } finally { proj.cleanup(); }
  });

  it("kj advanced lists the specialized commands and exits 0", () => {
    const proj = makeTmpProject();
    try {
      const r = runKj(["advanced"], { cwd: proj.projectDir });
      expect(r.exitCode).toBe(0);
      for (const cmd of ["audit", "board", "review", "code"]) {
        expect(r.stdout, `'${cmd}' missing from kj advanced`).toContain(cmd);
      }
    } finally { proj.cleanup(); }
  });

  it("kj <unknown-cmd> rejects with exit ≠ 0 and a useful suggestion", () => {
    const proj = makeTmpProject();
    try {
      const r = runKj(["plat"], { cwd: proj.projectDir });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/no es un comando válido|Did you mean/i);
      expect(r.stderr).toMatch(/'plan'|--help/);
    } finally { proj.cleanup(); }
  });

  it("kj generate plan --task-file SPEC.md (verb+noun reversed) emits the typo guard, NOT 'unknown option'", () => {
    // Regression: 2026-04-28 the user typed `kj generate plan ...` and
    // got `unknown option '--task-file'` — confusing because the real
    // problem was that 'generate' isn't a top-level subcommand. The
    // CLI guard added in v2.7.5 emits a clear error pointing at the
    // bad first word.
    const proj = makeTmpProject();
    try {
      const r = runKj(["generate", "plan", "--task-file", "SPEC.md"], { cwd: proj.projectDir });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/'generate' no es un comando válido/);
      // The misleading "unknown option" must NOT appear.
      expect(r.stderr).not.toMatch(/unknown option '--task-file'/);
    } finally { proj.cleanup(); }
  });

  it("kj plan generate --task-fil <path> (typo'd flag) suggests --task-file", () => {
    const proj = makeTmpProject({ spec: "demo" });
    try {
      const r = runKj(["plan", "generate", "--task-fil", "SPEC.md"], { cwd: proj.projectDir });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/--task-file/);
    } finally { proj.cleanup(); }
  });
});
