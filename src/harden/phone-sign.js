/**
 * KJC-TSK-0822 (PRP-0023) — capa 5 del sello del supervisor: firma asimétrica
 * desde el móvil. La clave privada vive SOLO en el teléfono; aquí se enrola su
 * clave PÚBLICA (~/.karajan/supervisor-phone.json) y se verifica ed25519
 * contra ella — el transporte (Firestore, PR siguiente) nunca es la verdad.
 */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import qrcode from "qrcode-terminal";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
// La config del relé (apiKey de cliente Firestore — pública por diseño, la
// misma que la página firmante lleva incrustada) NO viaja en el tarball: el
// escáner de privacidad del pack deniega claves google con razón general, y
// servirla desde la landing la hace además rotable sin release.
const RELAY_CONFIG_URL = "https://karajancode.com/sign/relay.json";
let relayCache = null;
async function relayConfig(fetchFn) {
  if (relayCache) return relayCache;
  const res = await fetchFn(RELAY_CONFIG_URL);
  if (!res.ok) throw new Error(`phone-sign: no pude cargar la config del relé (${res.status}) — revisa la red`);
  const cfg = await res.json();
  if (!cfg?.apiKey || !cfg?.projectId || !cfg?.collection) throw new Error("phone-sign: config del relé incompleta");
  relayCache = {
    apiKey: cfg.apiKey,
    url: `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/${cfg.collection}`,
  };
  return relayCache;
}
const SIGN_PAGE = "https://karajancode.com/sign";
const POLL_INTERVAL_MS = 2000;
const TTL_MS = 60000;

/** Spinner en su sitio (una línea, con \r) solo en TTY; no-op fuera de TTY o en tests. */
function makeSpinner() {
  if (!process.stdout?.isTTY) return { tick() {}, stop() {} };
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  return {
    tick() { process.stdout.write(`\r${frames[i++ % frames.length]} esperando la firma del móvil…`); },
    stop() { process.stdout.write("\r\x1b[K"); },
  };
}

const phoneKeyPath = (home) => join(home ?? homedir(), ".karajan", "supervisor-phone.json");

// KJC-TSK-0831 (ADR 0010): el padrón de firmantes vive VERSIONADO en el repo,
// no una única clave local — así un equipo comparte la confianza y el CI puede
// verificar (0823) contra el mismo conjunto. La legacy ~/.karajan sigue valiendo.
const signersPath = (projectDir) => join(projectDir ?? process.cwd(), ".karajan", "supervisor-signers.json");

/** Valida una clave pública ed25519 raw en base64 canónico (32 bytes). */
export function validatePhonePublicKey(publicKeyBase64) {
  const raw = Buffer.from(publicKeyBase64 ?? "", "base64");
  if (raw.length !== 32 || raw.toString("base64") !== publicKeyBase64) {
    throw new Error("la clave debe ser base64 canónico de EXACTAMENTE 32 bytes (ed25519 raw)");
  }
  return publicKeyBase64;
}

export const isPhoneEnrolled = ({ home } = {}) => existsSync(phoneKeyPath(home));

export const readEnrolledKey = ({ home } = {}) =>
  JSON.parse(readFileSync(phoneKeyPath(home), "utf8")).publicKey;

/** Claves públicas del padrón versionado del repo (o [] si no hay). */
export function readSigners({ projectDir } = {}) {
  try {
    const doc = JSON.parse(readFileSync(signersPath(projectDir), "utf8"));
    return Array.isArray(doc?.signers) ? doc.signers.map((s) => s.publicKey).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Conjunto de claves AUTORIZADAS a sellar: el padrón del repo ∪ la clave legacy
 * de ~/.karajan (compat). Sin fallbacks silenciosos: si no hay ninguna, el Set
 * está vacío y la verificación fallará ruidosamente.
 */
export function readEnrolledKeys({ projectDir, home } = {}) {
  const keys = new Set(readSigners({ projectDir }));
  if (isPhoneEnrolled({ home })) keys.add(readEnrolledKey({ home }));
  return keys;
}

/** Añade una clave pública al padrón versionado del repo (dedup). Acto humano. */
export function addSigner(publicKeyBase64, { projectDir, label } = {}) {
  validatePhonePublicKey(publicKeyBase64);
  const path = signersPath(projectDir);
  let doc = { signers: [] };
  try { doc = JSON.parse(readFileSync(path, "utf8")); } catch { /* new file */ }
  if (!Array.isArray(doc.signers)) doc.signers = [];
  if (doc.signers.some((s) => s.publicKey === publicKeyBase64)) return doc;
  doc.signers.push({ publicKey: publicKeyBase64, label: label ?? null, enrolledAt: new Date().toISOString() });
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return doc;
}

/** Valida y persiste la clave pública del móvil (legacy: clave única ~/.karajan). */
export function enrollPhone(publicKeyBase64, { home } = {}) {
  validatePhonePublicKey(publicKeyBase64);
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

/**
 * Publica la petición en Firestore, enseña QR + URL, pollea el doc y verifica
 * la firma. Sin fallbacks silenciosos: red caída o HTTP no-ok ⇒ throw. Firma
 * mala / clave ajena / TTL vencido ⇒ {ok:false, reason}.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function requestPhoneSignature({ project, files, kjVersion, logger = console, deps = {} }) {
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const drawQr = deps.qr ?? ((url) => qrcode.generate(url, { small: true }));
  const cid = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const body = {
    fields: {
      nonce: { stringValue: nonce },
      project: { stringValue: project },
      kj_version: { stringValue: kjVersion },
      state: { stringValue: "pending" },
      createdAt: { timestampValue: new Date().toISOString() },
      files: { arrayValue: { values: files.map((f) => ({ mapValue: { fields: { file: { stringValue: f.file }, sha256: { stringValue: f.sha256 ?? "" } } } })) } },
    },
  };
  const relay = await relayConfig(fetchFn);
  const created = await fetchFn(`${relay.url}?documentId=${cid}&key=${relay.apiKey}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!created.ok) {
    throw new Error(`phone-sign: no se pudo publicar la petición de firma (HTTP ${created.status}) — sin red no hay sello, no se degrada`);
  }
  const signUrl = `${SIGN_PAGE}?c=${cid}`;
  drawQr(signUrl);
  logger.info?.(`phone-sign: escanea el QR o abre ${signUrl} y firma en el móvil (caduca en ${TTL_MS / 1000}s)`);
  logger.info?.("phone-sign: esperando la firma del móvil…");
  const spinner = deps.spinner ?? makeSpinner();
  const deadline = now() + TTL_MS;
  while (now() < deadline) {
    const res = await fetchFn(`${relay.url}/${cid}?key=${relay.apiKey}`);
    if (!res.ok) { spinner.stop(); throw new Error(`phone-sign: fallo consultando la petición de firma (HTTP ${res.status})`); }
    const fields = (await res.json()).fields ?? {};
    if (fields.state?.stringValue === "signed") {
      spinner.stop();
      // KJC-TSK-0831 (ADR 0010): la clave que firma debe estar en el PADRÓN
      // autorizado (repo ∪ legacy). El doc es transporte; la verdad es el padrón.
      const authorized = readEnrolledKeys({ projectDir: deps.projectDir, home: deps.home });
      const signerKey = fields.publicKey?.stringValue;
      if (!signerKey || !authorized.has(signerKey)) {
        return { ok: false, reason: "la publicKey que firma no está en el padrón autorizado — el doc es transporte, la verdad es el padrón" };
      }
      const payload = canonicalPayload({ cid, nonce, project, files });
      const good = verifyPhoneSignature({ payload, signature: fields.signature?.stringValue ?? "", publicKey: signerKey });
      return good ? { ok: true, signer: signerKey } : { ok: false, reason: "firma ed25519 inválida para el payload canónico" };
    }
    spinner.tick();
    await sleep(POLL_INTERVAL_MS);
  }
  spinner.stop();
  return { ok: false, reason: "caducado" };
}
