// KJC-BUG-0161 / ADR 0009 (opción A) — el cauce sancionado del supervisor,
// pieza 2: `kj harden --commit` es un ACTO HUMANO que versiona la
// regeneración con procedencia: un fichero de provenance trackeado (versión
// de kj, parámetros de generación, sha256 por fichero) + sello en el acta
// local + commit que SOLO contiene supervisor y provenance.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { commitSupervisorRegeneration, PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";

let repo;
const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

// Cadena de procesos HUMANA inyectada: bash ← sshd ← init. Sin inyectar, la
// ascendencia REAL de la suite (que corre bajo un agente) rechazaría — que es
// exactamente lo que la capa debe hacer.
const humanChain = { 100: { ppid: 50, cmd: "bash" }, 50: { ppid: 1, cmd: "sshd: manu@pts/0" } };
const HUMAN = { env: {}, tty: true, deps: { confirm: (n) => n, ancestry: { pid: 100, readProc: (p) => humanChain[p] ?? { ppid: 1, cmd: "init" } } } };
const generation = { profile: "standard", cmds: { lint: "x" }, baseBranch: "main", globalHooksDir: "$HOME/.git-hooks" };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-supcommit-"));
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  mkdirSync(join(repo, ".karajan", "hooks"), { recursive: true });
  writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nold\n");
  writeFileSync(join(repo, "other.txt"), "untouched\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "seed", "--no-verify"]);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("kj harden --commit (KJC-BUG-0161)", () => {
  it("refuses inside an agent session — the channel is human-only", () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    for (const ctx of [
      { env: { CLAUDECODE: "1" }, tty: true },
      { env: { KJ_NON_INTERACTIVE: "1" }, tty: true },
      { env: {}, tty: false },
    ]) {
      expect(() =>
        commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...ctx }),
      ).toThrow(/humano/);
    }
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(1);
  });

  it("a faked pty with a clean env still refuses: the process DESCENDS from an agent", () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    // script(1) + env -u: tty=true y env limpio — pero la cadena de procesos
    // delata al agente: script ← sh ← node(claude).
    const chain = { 200: { ppid: 150, cmd: "script -qec kj harden --commit" }, 150: { ppid: 120, cmd: "sh" }, 120: { ppid: 1, cmd: "node /usr/lib/claude-code/cli.js" } };
    expect(() =>
      commitSupervisorRegeneration({
        projectDir: repo, kjVersion: "9.9.9", generation, env: {}, tty: true,
        deps: { ancestry: { pid: 200, readProc: (p) => chain[p] ?? { ppid: 1, cmd: "init" } } },
      }),
    ).toThrow(/desciende de un agente/);
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(1);
  });

  it("a blind prompt-feeder fails the nonce: layer 4 refuses (adversarial catch, 6-sep)", () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    for (const confirm of [() => "\n", () => "yes", () => null]) {
      expect(() =>
        commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion: "9.9.9", generation, deps: { ...HUMAN.deps, confirm } }),
      ).toThrow(/confirmación humana fallida/);
    }
    expect(git(["log", "--oneline"]).split("\n").filter(Boolean).length).toBe(1);
  });

  it("with drift: writes provenance, seals the acta, and commits ONLY supervisor+provenance", () => {
    writeFileSync(join(repo, ".karajan", "hooks", "pre-commit"), "#!/bin/sh\nnew\n");
    writeFileSync(join(repo, "other.txt"), "dirty working tree survives\n");
    const res = commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.kj_version).toBe("9.9.9");
    expect(prov.generation.globalHooksDir).toBe("$HOME/.git-hooks");
    expect(prov.files.some((f) => f.file === ".karajan/hooks/pre-commit" && /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    // el acta local ganó el sello
    const acta = readFileSync(join(repo, ".karajan", "policy-decisions.jsonl"), "utf8");
    expect(acta).toContain("supervisor-regeneration");
    // el commit contiene EXACTAMENTE supervisor + provenance (other.txt fuera)
    const shown = git(["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean);
    expect(shown).toContain(".karajan/hooks/pre-commit");
    expect(shown).toContain(PROVENANCE_FILE);
    expect(shown).not.toContain("other.txt");
  });

  it("a DELETED hook is drift too — recorded as deleted, committed (codex catch)", () => {
    rmSync(join(repo, ".karajan", "hooks", "pre-commit"));
    const res = commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".karajan/hooks/pre-commit", deleted: true });
    expect(git(["show", "--name-status", "--format=", "HEAD"])).toContain("D\t.karajan/hooks/pre-commit");
  });

  it("a RENAMED hook yields both paths — old as deleted, new hashed (codex catch)", () => {
    git(["mv", ".karajan/hooks/pre-commit", ".karajan/hooks/pre-commit-new"]);
    const res = commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(res.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files).toContainEqual({ file: ".karajan/hooks/pre-commit", deleted: true });
    expect(prov.files.some((f) => f.file === ".karajan/hooks/pre-commit-new" && f.sha256)).toBe(true);
  });

  it("without drift AND full coverage: commits nothing; partial coverage RESEALS (estreno catch)", () => {
    // Primer sello: sin drift pero sin provenance ⇒ resella (cobertura).
    const first = commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(first.committed).toBe(true);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    expect(prov.files.length).toBe(1);
    // Segundo: sin drift y cubierto ⇒ nada.
    const second = commitSupervisorRegeneration({ projectDir: repo, kjVersion: "9.9.9", generation, ...HUMAN });
    expect(second.committed).toBe(false);
  });
});
