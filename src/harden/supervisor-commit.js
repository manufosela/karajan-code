/**
 * KJC-BUG-0161 / ADR 0009 (opción A) — `kj harden --commit`, el cauce
 * sancionado del supervisor: ACTO HUMANO que versiona la regeneración con
 * provenance trackeada (versión, parámetros, sha256), sello en el acta y
 * commit quirúrgico. El --no-verify es a conciencia: lo que salta en local
 * lo re-verifica CI contra la provenance (pieza 3).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { recordGateDecision } from "../policy/decisions.js";
import { readIdentity } from "../identity/store.js";
import { ensureGateTrackable } from "../review/gate-gitignore.js";
import { signAct } from "./act-sign.js";
import { humanActOf } from "./human-act.js";
import { describeSupervisorChanges } from "./sign-changes.js";

export const PROVENANCE_FILE = ".karajan/supervisor-provenance.json";
const HOOKS_PREFIX = ".karajan/hooks/";
// KJC-BUG-0197: la procedencia del supervisor no cubría los guardias del
// supervisor. Sellaba los hooks de git y ningún .mjs del harness, que son
// justo los que vigilan la sesión, así que nada externo podía decir si un
// guardia instalado era auténtico. Los ficheros siguen fuera de git (los
// veredictos son locales por diseño); lo que viaja y se firma es su HUELLA,
// dentro de una procedencia que sí está trackeada.
const HARNESS_PREFIX = ".karajan/harness/";

const sha256 = (abs) => createHash("sha256").update(readFileSync(abs)).digest("hex");


/** Ficheros de supervisor TRACKEADOS con cambios (staged o no). */
/**
 * KJC-BUG-0197: los guardias del Sentinel que el sello debe cubrir. No salen de
 * `git status` (están gitignorados), así que se leen del disco. Un proyecto sin
 * harness (perfil minimal) sella los hooks y nada más.
 * @returns {string[]} rutas relativas, ordenadas
 */
export function harnessGuards(projectDir) {
  try {
    return readdirSync(join(projectDir, HARNESS_PREFIX))
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => HARNESS_PREFIX + f)
      .sort();
  } catch {
    return [];
  }
}

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
 * @returns {Promise<{committed: boolean, reason?: string, files?: object[]}>}
 */
export async function commitSupervisorRegeneration({
  projectDir,
  kjVersion,
  generation,
  logger = console,
  gitFn = null,
  env = process.env,
  tty = process.stdout.isTTY,
  deps = {},
}) {
  // El cauce es humano por diseño (ADR 0009): una sesión de agente no lo usa.
  // Capas 1 a 3 (entorno, tty y ascendencia de procesos): src/harden/human-act.js.
  const seal = humanActOf("supervisor-seal");
  seal.refuse({ env, tty, ancestry: deps.ancestry ?? {} });
  const run = gitFn || ((args) => execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }));
  // KJC-BUG-0244 (grebla #958): el commit sellado solo lleva el supervisor, pero
  // un stage ajeno se quedaba en esta rama y el siguiente commit caía aquí con la
  // card equivocada. Se para ANTES de pedir nada al humano y se nombra.
  const foreign = run(["diff", "--cached", "--name-only"]).split("\n").filter((f) => f && !f.startsWith(HOOKS_PREFIX) && f !== PROVENANCE_FILE);
  if (foreign.length > 0) {
    throw new Error(
      `harden --commit: hay cambios en el stage que no son del supervisor (${foreign.slice(0, 5).join(", ")}${foreign.length > 5 ? ", …" : ""}): commitéalos en su rama o sácalos del stage (git restore --staged <ficheros>) antes de sellar`,
    );
  }
  // Capa 4 (test adversarial 6-sep: un huérfano a init con pty falso y
  // prompts a ciegas llegó hasta aquí): nonce aleatorio tecleado de vuelta.
  seal.confirm(deps.confirm);
  const drift = supervisorDrift({ projectDir, gitFn: run });
  // La provenance describe SIEMPRE el estado COMPLETO del supervisor (cazado
  // en el primer estreno real: un sello parcial pisaba al anterior y dejaba
  // ficheros sin respaldo). Borrados del drift ⇒ deleted (catch de codex).
  const current = [
    ...readdirSync(join(projectDir, HOOKS_PREFIX)).map((f) => HOOKS_PREFIX + f),
    ...harnessGuards(projectDir),
  ].sort();
  // KJC-BUG-0197: un guardia BORRADO se anota como borrado, igual que un hook.
  // No hacía falta para desencadenar el re-sello (la lista encoge, así que la
  // cobertura ya falla), pero registrar la ausencia dice más que omitirla:
  // quien lea la procedencia ve que ese guardia se fue, no que nunca estuvo.
  const previousGuards = (() => {
    try {
      return JSON.parse(readFileSync(join(projectDir, PROVENANCE_FILE), "utf8"))?.files ?? [];
    } catch { return []; }
  })();
  const goneGuards = previousGuards
    .map((f) => f?.file)
    .filter((f) => typeof f === "string" && f.startsWith(HARNESS_PREFIX) && !existsSync(join(projectDir, f)));
  const hashed = [
    ...current.map((file) => ({ file, sha256: sha256(join(projectDir, file)) })),
    ...drift.filter((f) => !existsSync(join(projectDir, f))).map((file) => ({ file, deleted: true })),
    ...goneGuards.map((file) => ({ file, deleted: true })),
  ];
  let previous = null;
  try { previous = JSON.parse(readFileSync(join(projectDir, PROVENANCE_FILE), "utf8")); } catch { /* primer sello */ }
  const covered = JSON.stringify(previous?.files ?? null) === JSON.stringify(hashed);
  if (drift.length === 0 && covered) {
    logger.info?.("harden --commit: sin drift y provenance completa — nada que versionar");
    return { committed: false, reason: "sin drift" };
  }
  // Capa 5 (KJC-TSK-0822 / PRP-0023, KJC-TSK-0996 / ADR 0018): the level applied
  // by the catalog's mechanism. With a phone enrolled its signature over the SAME
  // files/hashes of the provenance is mandatory, never nonce-only; at max with no
  // phone the seal is refused. KJC-TSK-0992: the page says what is signed, file by
  // file; KJC-TSK-0823: the block is recorded so CI re-verifies server-side.
  let branch = null;
  try { branch = run(["rev-parse", "--abbrev-ref", "HEAD"]).trim(); } catch { /* unborn HEAD */ }
  const { signature: signatureBlock } = await signAct("supervisor-seal", {
    projectDir, kjVersion, branch, logger, deps,
    files: hashed.map(({ file, sha256: hash }) => ({ file, sha256: hash ?? "" })),
    changes: (deps.describeChanges ?? describeSupervisorChanges)({ projectDir, files: hashed }),
  });
  const who = readIdentity(projectDir);
  const provenance = {
    kj_version: kjVersion,
    generated_at: new Date().toISOString(),
    generation,
    who: who ? { gh: who.gh_user ?? null, git: who.git_email ?? null, grade: "declarada" } : null,
    files: hashed,
    ...(signatureBlock ? { signature: signatureBlock } : {}),
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
  // KJC-BUG-0264: un bloque .karajan antiguo en .gitignore dejaba la procedencia
  // fuera de git y el add fallaba. Se completa antes el bloque canónico (la misma
  // migración que kj review --install-gate); el cambio queda para una PR normal.
  if ((await ensureGateTrackable(projectDir)).changed) {
    logger.info?.("harden --commit: .gitignore completado con el bloque canónico de .karajan (la procedencia viaja con el repo); súbelo en una PR");
  }
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
  logger.info?.(`harden --commit: ${hashed.length} fichero(s) de supervisor versionados con procedencia sellada`);
  return { committed: true, files: hashed };
}
