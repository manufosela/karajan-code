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
import { PHONE_INVITE } from "./phone-invite.js";
import { isPhoneEnrolled, readEnrolledKeys, requestPhoneSignature, verifySignedFiles } from "./phone-sign.js";

export const SECURITY_LEVEL_FILE = ".karajan/security-level.json";
// ADR 0018 (KJC-TSK-0997): `max` is the default now that CI verifies the signature
// (HUM-A) and the recovery code exists (HUM-B). The level that protects whoever
// does not know the risk exists; `kj security normal` lowers it, signed.
export const DEFAULT_LEVEL = "max";

const levelPath = (projectDir) => join(projectDir, SECURITY_LEVEL_FILE);
const recordBytes = (record) => `${JSON.stringify(record, null, 2)}\n`;
const unsigned = ({ level, since }) => ({ level, since });

/** What the phone signs when the level goes down: the record without its signature. */
export const signedFilesOf = (record) => [
  { file: SECURITY_LEVEL_FILE, sha256: createHash("sha256").update(recordBytes(unsigned(record))).digest("hex") },
];

/**
 * The level in force. A record that cannot be trusted reads as `max` and says why.
 * @returns {{level: "max"|"normal", source: "default"|"file"|"invalid", since?: string, signer?: string, reason?: string}}
 */
export function readSecurityLevel({ projectDir, home } = {}) {
  const invalid = (reason) => ({ level: "max", source: "invalid", reason: `${SECURITY_LEVEL_FILE}: ${reason}` });
  const path = levelPath(projectDir);
  if (!existsSync(path)) return { level: DEFAULT_LEVEL, source: "default" };
  let record;
  try { record = JSON.parse(readFileSync(path, "utf8")); } catch (err) { return invalid(`no es JSON (${err.message})`); }
  if (record?.level === "max") return { level: "max", source: "file", since: record.since };
  if (record?.level !== "normal") return invalid("declara un nivel que no existe");
  const keys = readEnrolledKeys({ projectDir, home });
  const check = verifySignedFiles({ sig: record.signature, files: signedFilesOf(record), keys });
  if (!check.ok) return invalid(`el nivel normal ${check.reason}; vale como máxima`);
  return { level: "normal", source: "file", since: record.since, signer: record.signature.signer };
}

/** Up to `max`: no act, no signature; it also replaces a record that cannot be trusted. */
export function raiseSecurityLevel({ projectDir, home } = {}) {
  const current = readSecurityLevel({ projectDir, home });
  if (current.level === "max" && current.source !== "invalid") return { changed: false, level: current };
  mkdirSync(dirname(levelPath(projectDir)), { recursive: true });
  writeFileSync(levelPath(projectDir), recordBytes({ level: "max", since: new Date().toISOString() }), "utf8");
  return { changed: true, level: readSecurityLevel({ projectDir, home }) };
}

const explain = (status) => ({
  file: SECURITY_LEVEL_FILE, status, added: 3, removed: status === "modified" ? 3 : 0, truncated: false,
  summary: "El nivel de seguridad de este proyecto baja de máxima a normal.",
  diff: [
    "Qué se va a hacer: los actos del catálogo (sellar el supervisor, aprobar reglas, enrolar un móvil) pasan a confirmarse",
    "con las cuatro capas de ADR 0009 y un código tecleado; el móvil deja de firmarlos.",
    "Por qué se pide tu firma: bajar el nivel es un acto del catálogo (ADR 0018); si no se firmara, el primero en bajarlo sería el agente.",
    "Si lo hiciera otro: un registro de nivel normal sin la firma de un móvil del padrón no vale, y kj aplica la máxima.",
  ].join("\n"),
});

/** Down to `normal`: the catalog act, four layers and the phone's signature; without a phone it refuses. */
export async function lowerSecurityLevel({ projectDir, home, kjVersion, env, tty, deps = {}, logger = console }) {
  const act = humanActOf("security-level-down");
  act.refuse({ env, tty, ancestry: deps.ancestry ?? {} });
  const current = readSecurityLevel({ projectDir, home });
  if (current.level === "normal") return { changed: false, level: current };
  const phone = deps.phone ?? { enrolled: isPhoneEnrolled, request: requestPhoneSignature };
  if (!phone.enrolled({ home })) throw new Error(`${act.label}: bajar el nivel se firma con el móvil y no hay ninguno enrolado. ${PHONE_INVITE}`);
  act.confirm(deps.confirm);
  const record = { level: "normal", since: new Date().toISOString() };
  let branch = null;
  try { branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectDir, encoding: "utf8" }).trim(); } catch { /* no repo */ }
  const signed = await phone.request({
    project: basename(projectDir), files: signedFilesOf(record), kjVersion, branch, logger,
    changes: [explain(existsSync(levelPath(projectDir)) ? "modified" : "new")],
    origin: `kj security normal (kj ${kjVersion})`, deps: { projectDir, home },
  });
  if (!signed.ok) throw new Error(`${act.label}: firma del móvil rechazada (${signed.reason}); el nivel no cambia`);
  if (!signed.challenge || !signed.signer || !signed.signature) throw new Error(`${act.label}: el relé no devolvió un desafío firmado que kj pueda grabar; el nivel no cambia`);
  const signature = { ...signed.challenge, signer: signed.signer, signature: signed.signature };
  mkdirSync(dirname(levelPath(projectDir)), { recursive: true });
  writeFileSync(levelPath(projectDir), recordBytes({ ...record, signature }), "utf8");
  return { changed: true, level: readSecurityLevel({ projectDir, home }) };
}
