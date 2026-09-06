/**
 * KJC-TSK-0822 (PRP-0023) — capa 5 del sello del supervisor: firma asimétrica
 * desde el móvil. La clave privada vive SOLO en el teléfono; aquí se enrola su
 * clave PÚBLICA (~/.karajan/supervisor-phone.json) y se verifica ed25519
 * contra ella — el transporte (Firestore, PR siguiente) nunca es la verdad.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const phoneKeyPath = (home) => join(home ?? homedir(), ".karajan", "supervisor-phone.json");

export const isPhoneEnrolled = ({ home } = {}) => existsSync(phoneKeyPath(home));

export const readEnrolledKey = ({ home } = {}) =>
  JSON.parse(readFileSync(phoneKeyPath(home), "utf8")).publicKey;

/** Valida y persiste la clave pública del móvil (base64 del raw de 32 bytes). */
export function enrollPhone(publicKeyBase64, { home } = {}) {
  const raw = Buffer.from(publicKeyBase64 ?? "", "base64");
  if (raw.length !== 32 || raw.toString("base64") !== publicKeyBase64) {
    throw new Error("la clave debe ser base64 canónico de EXACTAMENTE 32 bytes (ed25519 raw)");
  }
  mkdirSync(join(phoneKeyPath(home), ".."), { recursive: true });
  const record = { publicKey: publicKeyBase64, enrolledAt: new Date().toISOString() };
  writeFileSync(phoneKeyPath(home), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/** Payload canónico firmado: files EXACTAMENTE como se enviaron, JSON sin espacios. */
export function canonicalPayload({ cid, nonce, project, files }) {
  const filesHash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return `kj-supervisor-sign:v1:${cid}:${nonce}:${project}:${filesHash}`;
}

/** Verifica la firma (base64) del payload contra la clave pública raw (base64). */
export function verifyPhoneSignature({ payload, signature, publicKey }) {
  const der = Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKey, "base64")]);
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  return verify(null, Buffer.from(payload, "utf8"), key, Buffer.from(signature, "base64"));
}
