/**
 * KJC-TSK-0965 (HUM-B, ADR 0018): the roster of signing phones and its recovery
 * code. A phone enters with an ADMISSION: a present phone's signature over the
 * sha256 of its key, or the recovery code, spent. The code is shown once and NEVER
 * stored: the roster keeps sha256(sha256(code)), and spending it reveals sha256(code),
 * which only the holder can produce. CI judges a change with `verifyRosterChange`.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { validatePhonePublicKey, verifySignedFiles } from "./phone-sign.js";

export const SIGNERS_FILE = ".karajan/supervisor-signers.json";
const CODE_RE = /^kjrc(-[a-z2-7]{5}){4}$/;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const short = (key) => `${String(key).slice(0, 8)}…`;
const validKey = (key) => { try { validatePhonePublicKey(key); return true; } catch { return false; } };

/** 100 random bits as kjrc-xxxxx-xxxxx-xxxxx-xxxxx; the roster keeps the fingerprint only. */
export function issueRecoveryCode(random = randomBytes) {
  const chars = [...random(20)].map((b) => "abcdefghijklmnopqrstuvwxyz234567"[b & 31]);
  const code = `kjrc-${[0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-")}`;
  return { code, fingerprint: sha256(sha256(code)) };
}

/** What a present phone signs to admit a key: the roster file and the key's sha256. */
export const admissionFiles = (publicKey) => [{ file: SIGNERS_FILE, sha256: sha256(publicKey) }];

const normalize = (doc) => ({ signers: Array.isArray(doc?.signers) ? doc.signers.filter((s) => typeof s?.publicKey === "string") : [], recovery: doc?.recovery ?? null });

export function readRoster({ projectDir }) {
  try { return normalize(JSON.parse(readFileSync(join(projectDir, SIGNERS_FILE), "utf8"))); } catch { return normalize(null); }
}

/** The code must match the roster's fingerprint; returns the admission (its proof, not the code). Writes nothing. */
export function redeemRecoveryCode(code, { projectDir }) {
  if (!CODE_RE.test(code ?? "")) throw new Error("el código de recuperación no tiene el formato kjrc-xxxxx-xxxxx-xxxxx-xxxxx");
  const { recovery } = readRoster({ projectDir });
  if (!recovery?.fingerprint) throw new Error("este padrón no tiene código de recuperación: se emite al enrolar el primer móvil");
  const proof = sha256(code);
  if (sha256(proof) !== recovery.fingerprint) throw new Error("el código de recuperación no es el de este padrón");
  return { recoveryProof: proof };
}

/**
 * Adds a signer with its admission and writes the roster. The first signer, a spent
 * code and a roster with no code yet issue a NEW code, returned once and never stored.
 */
export function admitSigner({ projectDir, publicKey, label = null, admission = null, random }) {
  validatePhonePublicKey(publicKey);
  const roster = readRoster({ projectDir });
  if (roster.signers.some((s) => s.publicKey === publicKey)) return { roster, recoveryCode: null };
  const first = roster.signers.length === 0;
  if (!first && !admission) throw new Error("un móvil nuevo entra firmado por uno del padrón o con el código de recuperación (ADR 0018)");
  const enrolledAt = new Date().toISOString();
  const next = { signers: [...roster.signers, { publicKey, label, enrolledAt, ...(admission ? { admission } : {}) }], recovery: roster.recovery };
  let recoveryCode = null;
  if (first || admission?.recoveryProof || !roster.recovery) {
    const issued = issueRecoveryCode(random);
    recoveryCode = issued.code;
    next.recovery = { fingerprint: issued.fingerprint, issuedAt: enrolledAt };
  }
  const path = join(projectDir, SIGNERS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { roster: next, recoveryCode };
}

/**
 * CI's judgment of a roster change: every key that enters carries a valid admission,
 * no key leaves, and the code's sha256 rotates only when one is spent (once).
 * @returns {{ok: boolean, reason?: string, bootstrap?: boolean, added?: number, spent?: boolean}}
 */
export function verifyRosterChange({ before, after }) {
  const fail = (reason) => ({ ok: false, reason });
  const prev = normalize(before);
  const next = normalize(after);
  const present = new Set(prev.signers.map((s) => s.publicKey));
  const fresh = /^[0-9a-f]{64}$/.test(next.recovery?.fingerprint ?? "") ? next.recovery.fingerprint : null;
  const gone = prev.signers.find((s) => !next.signers.some((n) => n.publicKey === s.publicKey));
  if (gone) return fail(`el padrón pierde la clave ${short(gone.publicKey)}: una baja no tiene mecanismo en kj y solo se hace por fuera de CI, a la vista`);
  if (present.size === 0) return next.signers.length === 1 && fresh && validKey(next.signers[0].publicKey) ? { ok: true, bootstrap: true } : fail("el primer padrón lleva UN móvil (clave ed25519 válida) y la huella de su código de recuperación; los demás entran admitidos");
  const added = next.signers.filter((n) => !present.has(n.publicKey));
  let spent = false;
  for (const entry of added) {
    if (!validKey(entry.publicKey)) return fail(`la clave ${short(entry.publicKey)} no es una clave ed25519 válida (base64 de 32 bytes)`);
    const admission = entry.admission ?? null;
    if (admission?.recoveryProof) {
      if (spent) return fail("un código de recuperación admite UNA clave, y este cambio mete dos con él");
      if (sha256(String(admission.recoveryProof)) !== prev.recovery?.fingerprint) return fail(`la clave ${short(entry.publicKey)} entra con un código de recuperación que no es el del padrón anterior`);
      spent = true;
      continue;
    }
    const check = verifySignedFiles({ sig: admission, files: admissionFiles(entry.publicKey), keys: present });
    if (!check.ok) return fail(`la clave ${short(entry.publicKey)} entra sin admisión válida: ${check.reason}`);
  }
  if (spent && (!fresh || fresh === prev.recovery?.fingerprint)) return fail("el código de recuperación se gastó y el padrón no trae la huella de uno nuevo");
  if (!spent && (prev.recovery ? fresh !== prev.recovery.fingerprint : added.length > 0 && !fresh)) return fail("la huella del código de recuperación cambia sin que se haya gastado ninguno, o falta cuando entra un móvil en un padrón sin código");
  return { ok: true, added: added.length, spent };
}
