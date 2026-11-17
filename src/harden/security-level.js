/**
 * KJC-TSK-0967 (HUM-D, ADR 0018): the project's security level, versioned in
 * .karajan/security-level.json: `max` (every catalog act signed by the phone
 * over the exact bytes) or `normal` (the four layers of ADR 0009, a lesser
 * guarantee said at every act). Going DOWN is itself a catalog act signed by an
 * enrolled phone over the record's bytes; a `normal` record without that
 * signature reads as `max`. Going up is free.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { humanActOf } from "./human-act.js";
import { PHONE_ENROLL } from "./phone-texts.js";
import { anyAuthorizedPhone, readEnrolledKeys, readPasskeyCredentials, requestPhoneSignature, verifySignedFiles } from "./phone-sign.js";

export const SECURITY_LEVEL_FILE = ".karajan/security-level.json";
// ADR 0018 (KJC-TSK-0997) made `max` the default. ADR 0060 (KJC-TSK-1654, the maintainer's
// decision of 2026-11-16): `critical` is the default, the phone signs what changes who governs;
// `kj security max` (free) is the paranoid mode that signs every act, and a repo whose record
// already says max keeps it.
export const DEFAULT_LEVEL = "critical";

const levelPath = (projectDir) => join(projectDir, SECURITY_LEVEL_FILE);
const NO_PHONE = "no-phone-enrolled";
const SIGNED_LEVELS = new Set(["critical", "normal"]);
const recordBytes = (record) => `${JSON.stringify(record, null, 2)}\n`;
const unsigned = ({ level, since }) => ({ level, since });

/** What the phone signs when the level goes down: the record without its signature. */
export const signedFilesOf = (record) => [
  { file: SECURITY_LEVEL_FILE, sha256: createHash("sha256").update(recordBytes(unsigned(record))).digest("hex") },
];

/**
 * The level in force. A record that cannot be trusted reads as `max` and says why.
 * @returns {{level: "max"|"critical"|"normal", source: "default"|"file"|"invalid", since?: string, signer?: string, reason?: string}}
 */
export function readSecurityLevel({ projectDir, home } = {}) {
  const invalid = (reason) => ({ level: "max", source: "invalid", reason: `${SECURITY_LEVEL_FILE}: ${reason}` });
  const path = levelPath(projectDir);
  if (!existsSync(path)) return { level: DEFAULT_LEVEL, source: "default" };
  let record;
  try { record = JSON.parse(readFileSync(path, "utf8")); } catch (err) { return invalid(`no es JSON (${err.message})`); }
  if (record?.level === "max") return { level: "max", source: "file", since: record.since };
  // KJC-TSK-1654 (ADR 0060): critical, like normal, is below max, so only a signed record holds it.
  if (!SIGNED_LEVELS.has(record?.level)) return invalid("declara un nivel que no existe");
  const keys = readEnrolledKeys({ projectDir, home });
  // KJC-TSK-1045 (ADR 0020): lowered at the terminal while no phone existed; it
  // lasts only while none does, since every act at normal still asks for the human layers.
  // HU-4019: a live roster passkey is a phone too.
  const { level } = record;
  if (record.unsigned === NO_PHONE && !record.signature) {
    if (!anyAuthorizedPhone({ projectDir, home })) return { level, source: "file", since: record.since, unsigned: true };
    return invalid(`el nivel ${level} se bajó sin móvil y ya hay uno enrolado; vale como máxima hasta bajarlo firmado`);
  }
  const check = verifySignedFiles({ sig: record.signature, files: signedFilesOf(record), keys, passkeys: readPasskeyCredentials({ projectDir }) });
  if (!check.ok) return invalid(`el nivel ${level} ${check.reason}; vale como máxima`);
  return { level, source: "file", since: record.since, signer: record.signature.signer ?? record.signature.credentialId };
}

/** Up to `max`: no act, no signature; it also replaces a record that cannot be trusted. */
export function raiseSecurityLevel({ projectDir, home } = {}) {
  const current = readSecurityLevel({ projectDir, home });
  if (current.level === "max" && current.source !== "invalid") return { changed: false, level: current };
  mkdirSync(dirname(levelPath(projectDir)), { recursive: true });
  writeFileSync(levelPath(projectDir), recordBytes({ level: "max", since: new Date().toISOString() }), "utf8");
  return { changed: true, level: readSecurityLevel({ projectDir, home }) };
}

// KJC-TSK-1654 (ADR 0060): what each level below max leaves to the terminal.
const LEAVES = {
  normal: [
    "Qué se va a hacer: los actos del catálogo (sellar el supervisor, aprobar reglas, enrolar un móvil) pasan a confirmarse",
    "con las cuatro capas de ADR 0009 y un código tecleado; el móvil deja de firmarlos.",
  ],
  critical: [
    "Qué se va a hacer: el móvil sigue firmando lo que cambia quién gobierna (enrolar un móvil, bajar el nivel, aflojar un gate,",
    "la excepción de main-guard); los demás actos (sello, reglas, hooks, release) se confirman con las cuatro capas de ADR 0009.",
  ],
};
const explain = (status, to) => ({
  file: SECURITY_LEVEL_FILE, status, added: 3, removed: status === "modified" ? 3 : 0, truncated: false,
  summary: `El nivel de seguridad de este proyecto baja de máxima a ${to}.`,
  diff: [
    ...LEAVES[to],
    "Por qué se pide tu firma: bajar el nivel es un acto del catálogo (ADR 0018); si no se firmara, el primero en bajarlo sería el agente.",
    `Si lo hiciera otro: un registro de nivel ${to} sin la firma de un móvil del padrón no vale, y kj aplica la máxima.`,
  ].join("\n"),
});

/** Down to `normal` or `critical`: the catalog act, four layers and the phone's signature; without a phone it refuses. */
export async function lowerSecurityLevel({ projectDir, home, kjVersion, env, tty, to = "normal", deps = {}, logger = console }) {
  if (!SIGNED_LEVELS.has(to)) throw new Error(`kj security: "${to}" is not a level below max (critical or normal)`);
  const act = humanActOf("security-level-down");
  act.refuse({ env, tty, ancestry: deps.ancestry ?? {} });
  const current = readSecurityLevel({ projectDir, home });
  if (current.level === to && current.source !== "invalid") return { changed: false, level: current };
  // KJC-TSK-1045 (ADR 0020): with no phone anywhere, max only blocks; the human
  // layers and the typed code are the proof, and the record says it is unsigned.
  if (!anyAuthorizedPhone({ projectDir, home })) {
    act.confirm(deps.confirm);
    mkdirSync(dirname(levelPath(projectDir)), { recursive: true });
    writeFileSync(levelPath(projectDir), recordBytes({ level: to, since: new Date().toISOString(), unsigned: NO_PHONE }), "utf8");
    logger.info?.(`${act.label}: nivel ${to} sin firma (no hay ningún móvil enrolado); en cuanto enroles uno vuelve a valer la máxima. ${PHONE_ENROLL}`);
    return { changed: true, level: readSecurityLevel({ projectDir, home }) };
  }
  // HU-3887 (KJC-BUG-0551): any phone of the roster signs, not only this machine's.
  const phone = { enrolled: anyAuthorizedPhone, request: requestPhoneSignature, ...deps.phone };
  if (!phone.enrolled({ projectDir, home })) throw new Error(`${act.label}: bajar el nivel se firma con el móvil y no hay ninguno enrolado. ${PHONE_ENROLL}`);
  act.confirm(deps.confirm);
  const record = { level: to, since: new Date().toISOString() };
  let branch = null;
  try { branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectDir, encoding: "utf8" }).trim(); } catch { /* no repo */ }
  const signed = await phone.request({
    project: basename(projectDir), files: signedFilesOf(record), kjVersion, branch, logger,
    changes: [explain(existsSync(levelPath(projectDir)) ? "modified" : "new", to)],
    origin: `kj security ${to} (kj ${kjVersion})`, deps: { projectDir, home },
  });
  if (!signed.ok) throw new Error(`${act.label}: firma del móvil rechazada (${signed.reason}); el nivel no cambia`);
  if (!signed.challenge || !signed.block) throw new Error(`${act.label}: el relé no devolvió un desafío firmado que kj pueda grabar; el nivel no cambia`);
  const signature = signed.block;
  mkdirSync(dirname(levelPath(projectDir)), { recursive: true });
  writeFileSync(levelPath(projectDir), recordBytes({ ...record, signature }), "utf8");
  return { changed: true, level: readSecurityLevel({ projectDir, home }) };
}
