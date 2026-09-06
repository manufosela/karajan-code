/**
 * KJC-BUG-0161 / ADR 0009 (opción A) — `kj harden --commit`, el cauce
 * sancionado del supervisor: ACTO HUMANO que versiona la regeneración con
 * provenance trackeada (versión, parámetros, sha256), sello en el acta y
 * commit quirúrgico. El --no-verify es a conciencia: lo que salta en local
 * lo re-verifica CI contra la provenance (pieza 3).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { recordGateDecision } from "../policy/decisions.js";
import { readIdentity } from "../identity/store.js";

export const PROVENANCE_FILE = ".karajan/supervisor-provenance.json";
const HOOKS_PREFIX = ".karajan/hooks/";

const sha256 = (abs) => createHash("sha256").update(readFileSync(abs)).digest("hex");

/** Ficheros de supervisor TRACKEADOS con cambios (staged o no). */
export function supervisorDrift({ projectDir, gitFn }) {
  const run = gitFn || ((args) => execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }));
  // Un rename sale como "R  old -> new" (catch de codex): ambas rutas son
  // drift — la vieja se versiona como borrado y la nueva con su hash.
  return run(["status", "--porcelain", "--", ".karajan/hooks"])
    .split("\n")
    .flatMap((l) => l.slice(3).trim().split(" -> "))
    .filter((f) => f.startsWith(HOOKS_PREFIX));
}

/**
 * @returns {{committed: boolean, reason?: string, files?: object[]}}
 */
export function commitSupervisorRegeneration({
  projectDir,
  kjVersion,
  generation,
  logger = console,
  gitFn = null,
  env = process.env,
  tty = process.stdout.isTTY,
}) {
  // El cauce es humano por diseño (ADR 0009): una sesión de agente no lo usa.
  if (env.CLAUDECODE || env.KJ_NON_INTERACTIVE === "1" || !tty) {
    throw new Error(
      "harden --commit es un acto humano: córrelo desde TU terminal, fuera de una sesión de agente (ADR 0009)",
    );
  }
  const run = gitFn || ((args) => execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }));
  const files = supervisorDrift({ projectDir, gitFn: run });
  if (files.length === 0) {
    logger.info?.("harden --commit: sin drift en el supervisor — nada que versionar");
    return { committed: false, reason: "sin drift" };
  }
  // Borrados/renombrados también son drift (catch de codex): ausente ⇒ deleted.
  const hashed = files.map((file) => {
    const abs = join(projectDir, file);
    return existsSync(abs) ? { file, sha256: sha256(abs) } : { file, deleted: true };
  });
  const who = readIdentity(projectDir);
  const provenance = {
    kj_version: kjVersion,
    generated_at: new Date().toISOString(),
    generation,
    who: who ? { gh: who.gh_user ?? null, git: who.git_email ?? null, grade: "declarada" } : null,
    files: hashed,
  };
  writeFileSync(join(projectDir, PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  recordGateDecision(projectDir, {
    decision: "exempt",
    chokepoint: "supervisor",
    kind: "supervisor-regeneration",
    kj_version: kjVersion,
    files: hashed,
    who: provenance.who,
  });
  // Por DIRECTORIO, no por fichero: un rename ya staged deja la ruta vieja
  // sin existir y `git add -- <vieja>` falla; `-A` sobre el dir del
  // supervisor versiona altas, cambios, borrados y renombrados por igual.
  run(["add", "-A", "--", PROVENANCE_FILE, ".karajan/hooks"]);
  run([
    "commit",
    "--no-verify",
    "-m",
    `chore(harden): supervisor regenerated and sealed by kj harden v${kjVersion}`,
    "--",
    PROVENANCE_FILE,
    ".karajan/hooks",
  ]);
  logger.info?.(`harden --commit: ${files.length} fichero(s) de supervisor versionados con procedencia sellada`);
  return { committed: true, files: hashed };
}
