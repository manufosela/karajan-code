/**
 * BOOT-B (KJC-TSK-0858, epic KJC-PCS-0088) — the state of the REPOSITORY.
 *
 * The cold-start map of 20-sep found projects raised outside the method, and
 * nobody noticed until a gate blocked with no explanation: the harness
 * installed before git, the gate marker never committed (so a clone inherits
 * nothing), no identity declared (so the Sentinel later denies every git and
 * gh call). None of the other checks looks at this: they check tools, ports,
 * index coverage, the method's own report — never whether the repo itself was
 * set up in the right order.
 *
 * Two rules, both learned the hard way in this codebase:
 *  - The bootstrap phase is NOT a defect. A repo with no commit yet is
 *    starting, and saying otherwise is the false alarm that teaches people to
 *    ignore the output.
 *  - Every symptom carries the literal command that repairs it. A diagnosis
 *    nobody can act on is a complaint.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const STRATEGY_MANUAL = "manual";

const git = (projectDir, args) => execFileSync("git", ["-C", projectDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const gitOk = (projectDir, args) => { try { git(projectDir, args); return true; } catch { return false; } };

/** @internal Exported for dynamic import from tests. */
export function createRepoStateCheck({ projectDir }) {
  return {
    name: "repo-state",
    label: "estado del repositorio",
    strategy: STRATEGY_MANUAL,
    describe: "Detect a project raised or carried outside the method (order, contract, identity)",
    async detect() {
      const dir = projectDir;
      const has = (rel) => existsSync(join(dir, rel));
      const hardened = has(".karajan/hooks/pre-commit") || has(".karajan/review-gate");

      // 1. No repository. The gates live in git hooks, so there is nothing to
      //    govern yet — and if the harness is already there, it governs nothing.
      if (!has(".git")) {
        return {
          ok: false,
          severity: "warn",
          detail: hardened
            ? "el proyecto está sin repositorio y el harness ya está escrito: no gobierna nada"
            : "el proyecto está sin repositorio, así que ningún gate del método puede actuar",
          fix: "kj bootstrap (crea el repositorio y deja el método en orden), o git init si prefieres hacerlo a mano",
        };
      }

      // 2. The harness written before git existed: nothing tracks the contract,
      //    so cloning inherits nothing even though this clone looks hardened.
      const hasCommits = gitOk(dir, ["rev-parse", "--verify", "HEAD"]);
      if (!hasCommits) {
        return hardened
          ? { ok: true, severity: "info", detail: "fase de arranque: el método está escrito y falta el primer commit" }
          : { ok: true, severity: "info", detail: "fase de arranque: repositorio recién creado, sin método todavía" };
      }

      const symptoms = [];
      // Against HEAD, not the index (catch de codex): a file merely STAGED is
      // not inherited by a clone, which is the whole point of this symptom.
      const committed = (rel) => gitOk(dir, ["cat-file", "-e", `HEAD:${rel}`]);
      if (hardened && !committed(".karajan/review-gate") && !committed(".karajan/hooks/pre-commit")) {
        symptoms.push({
          detail: "el harness está instalado pero su contrato no está en git: quien clone no hereda ningún gate",
          fix: "git add .karajan/review-gate .karajan/hooks && git commit -m \"chore: el contrato del método\"",
        });
      }
      if (hardened && !has(".karajan/identity.local.yml")) {
        symptoms.push({
          detail: "este clon no declara identidad, y el Sentinel denegará cada git y cada gh hasta que la declares",
          fix: "kj identity set --gh <usuario> --email <correo>",
        });
      }

      if (symptoms.length === 0) return { ok: true, severity: "info", detail: "el repositorio está en orden" };
      return {
        ok: false,
        severity: "warn",
        detail: symptoms.map((s) => s.detail).join(" · "),
        fix: symptoms.map((s) => s.fix).join("  ·  "),
      };
    },
  };
}
