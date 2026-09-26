/**
 * KJC-BUG-0161 / ADR 0009 (opción A) — `kj harden --commit`, el cauce
 * sancionado del supervisor: ACTO HUMANO que versiona la regeneración con
 * provenance trackeada (versión, parámetros, sha256), sello en el acta y
 * commit quirúrgico. El --no-verify es a conciencia: lo que salta en local
 * lo re-verifica CI contra la provenance (pieza 3).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { recordGateDecision } from "../policy/decisions.js";
import { readIdentity } from "../identity/store.js";
import { isPhoneEnrolled, requestPhoneSignature } from "./phone-sign.js";

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

// Capa 3 del acto humano (test adversarial del 6-sep): un pty falso engaña a
// isTTY y `env -u` borra CLAUDECODE, pero el kj que lanza un agente DESCIENDE
// de su proceso — y eso está en /proc lo falsifique quien lo falsifique.
const AGENT_PROC = /claude|codex|copilot|gemini|opencode|\bagy\b/i;
export function agentAncestry({ pid = process.pid, readProc = null, maxDepth = 40 } = {}) {
  const read = readProc || ((p) => {
    const stat = readFileSync(`/proc/${p}/stat`, "utf8");
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    let cmd = "";
    try { cmd = readFileSync(`/proc/${p}/cmdline`).toString("utf8").replaceAll("\0", " "); } catch { /* gone */ }
    return { ppid, cmd };
  });
  let cur = pid;
  for (let i = 0; i < maxDepth && cur > 1; i += 1) {
    let info;
    try { info = read(cur); } catch { return { agent: false, unknown: true }; }
    if (info?.cmd && AGENT_PROC.test(info.cmd)) return { agent: true, match: info.cmd.slice(0, 80) };
    if (!Number.isFinite(info?.ppid) || info.ppid === cur) break;
    cur = info.ppid;
  }
  return { agent: false };
}

// Lee la respuesta del nonce de la TTY REAL del proceso (no de stdin, que un
// atacante alimenta por pipe): /dev/tty solo existe con terminal de control.
function defaultConfirm(nonce) {
  process.stdout.write(`harden --commit: teclea "${nonce}" para confirmar que eres humano: `);
  try {
    const buf = Buffer.alloc(64);
    const fd = openSync("/dev/tty", "r");
    const n = readSync(fd, buf, 0, 64);
    closeSync(fd);
    return buf.toString("utf8", 0, n).trim();
  } catch {
    return null;
  }
}

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
  if (env.CLAUDECODE || env.KJ_NON_INTERACTIVE === "1" || !tty) {
    throw new Error(
      "harden --commit es un acto humano: córrelo desde TU terminal, fuera de una sesión de agente (ADR 0009)",
    );
  }
  const anc = agentAncestry(deps.ancestry ?? {});
  if (anc.agent) {
    throw new Error(
      `harden --commit es un acto humano y este proceso desciende de un agente (${anc.match}) — ni con pty falso ni con el entorno limpio (ADR 0009)`,
    );
  }
  // Capa 4 (test adversarial 6-sep: un huérfano a init con pty falso y
  // prompts a ciegas llegó hasta aquí): nonce aleatorio tecleado de vuelta.
  // Un alimentador ciego no conoce el código; automatizar su lectura exige
  // un driver expect — premeditación inequívoca, no un descuido.
  const nonce = createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 6);
  const answer = (deps.confirm ?? defaultConfirm)(nonce);
  if (answer !== nonce) {
    throw new Error(`harden --commit: confirmación humana fallida (esperaba "${nonce}") — ADR 0009`);
  }
  const run = gitFn || ((args) => execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }));
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
  // Capa 5 (KJC-TSK-0822 / PRP-0023): con móvil enrolado la firma asimétrica
  // es OBLIGATORIA — jamás se degrada a solo-nonce. Firma los MISMOS
  // files/hashes de la provenance (normalizados al par {file, sha256}).
  const phone = deps.phone ?? { enrolled: isPhoneEnrolled, request: requestPhoneSignature };
  let signatureBlock = null;
  if (phone.enrolled({})) {
    const signed = await phone.request({
      project: basename(projectDir),
      files: hashed.map(({ file, sha256: hash }) => ({ file, sha256: hash ?? "" })),
      kjVersion,
      logger,
    });
    if (!signed.ok) {
      throw new Error(`capa 5: firma del móvil rechazada (${signed.reason}) — con móvil enrolado el sello exige su firma (PRP-0023)`);
    }
    // KJC-TSK-0823: graba el desafío + firma en la provenance para que CI
    // re-verifique server-side que un humano (clave del padrón) aprobó.
    if (signed.challenge && signed.signature) {
      signatureBlock = { ...signed.challenge, signer: signed.signer, signature: signed.signature };
    }
  }
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
