// KJC-BUG-0225 (issue #1839): dentro de un carril de `kj worktree start`, el
// plugin SCM del scanner (JGit) no sabe abrir un worktree enlazado, donde .git
// es un FICHERO que apunta a .git/worktrees/<carril>. El pre-gate respondia
// "sonar pre-gate UNAVAILABLE" y la ejecucion seguia, asi que TODO cambio hecho
// como el metodo manda (un carril por tarea) se saltaba el quality gate, y sin
// un rojo que lo dijera.
import { describe, it, expect } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildScannerOpts, isLinkedWorktree } from "../../src/sonar/scanner.js";

describe("buildScannerOpts en un carril", () => {
  it("en la raiz no toca el SCM: el blame sigue alimentando la asignacion de autoria", () => {
    const opts = buildScannerOpts("k", { sources: "src" });
    expect(opts).not.toContain("sonar.scm.disabled");
  });

  it("en un worktree enlazado desactiva el SCM, que es lo unico que JGit no sabe abrir", () => {
    const opts = buildScannerOpts("k", { sources: "src" }, { linkedWorktree: true });
    expect(opts).toContain("-Dsonar.scm.disabled=true");
    // Y lo demas se queda exactamente igual: el analisis es el mismo.
    expect(opts).toContain("-Dsonar.projectKey=k");
    expect(opts).toContain("-Dsonar.sources=src");
  });

  it("no se cuela dos veces si el proyecto ya lo declara", () => {
    const opts = buildScannerOpts("k", { scm_disabled: true }, { linkedWorktree: true });
    expect(opts.match(/sonar\.scm\.disabled/g)).toHaveLength(1);
  });

  it("un proyecto puede desactivar el SCM tambien en la raiz", () => {
    expect(buildScannerOpts("k", { scm_disabled: true })).toContain("-Dsonar.scm.disabled=true");
  });
});

describe("isLinkedWorktree", () => {
  // La senal es la causa literal del error de JGit: en un worktree enlazado y
  // en un submodulo, `.git` es un FICHERO. Sin proceso y sin depender de git.
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kj-lane-"));

  it("un .git que es FICHERO es un carril", () => {
    const d = tmp();
    try {
      fs.writeFileSync(path.join(d, ".git"), "gitdir: /repo/.git/worktrees/lane-1\n");
      expect(isLinkedWorktree(d)).toBe(true);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it("un .git que es DIRECTORIO es la raiz, y ahi el SCM sirve", () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, ".git"));
      expect(isLinkedWorktree(d)).toBe(false);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it("sin .git no hay SCM que desactivar, y no revienta", () => {
    const d = tmp();
    try {
      expect(isLinkedWorktree(d)).toBe(false);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});
