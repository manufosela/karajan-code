/**
 * HU-3919 (KJC-TSK-1530, ADR 0053): the judge of a passkey seal. A pure, offline
 * check of a WebAuthn assertion against a roster credential, as kj and CI run it.
 * The signature counter is NOT checked: synced passkeys report 0 (ADR 0053).
 */
import { createHash, createPublicKey, verify } from "node:crypto";

export const WEBAUTHN_RP_ID = "karajancode.com";
export const WEBAUTHN_ORIGIN = "https://karajancode.com";

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const MIN_AUTH_DATA = 37;
const B64URL = /^[A-Za-z0-9_-]+$/;
const FIELDS = ["authenticatorData", "clientDataJSON", "signature"];
// COSE alg → the SPKI key it must be and how node:crypto verifies it.
const ALGS = new Map([
  [-7, { keyType: "ec", curve: "prime256v1", digest: "sha256" }],
  [-8, { keyType: "ed25519", curve: undefined, digest: null }],
]);
const sha256 = (data) => createHash("sha256").update(data).digest();

function decodeAssertion(assertion) {
  if (!FIELDS.every((f) => typeof assertion?.[f] === "string" && B64URL.test(assertion[f]))) return null;
  return Object.fromEntries(FIELDS.map((f) => [f, Buffer.from(assertion[f], "base64url")]));
}

function checkClientData(bytes, expectedChallenge) {
  let client = null;
  try { client = JSON.parse(bytes.toString("utf8")); } catch { /* reported below */ }
  if (typeof client !== "object" || client === null) return "el clientDataJSON no es un objeto JSON";
  if (client.type !== "webauthn.get") return "el clientDataJSON no es de tipo webauthn.get";
  if (client.challenge !== expectedChallenge) return "el reto del clientDataJSON no es el de esta firma";
  if (client.origin !== WEBAUTHN_ORIGIN) return `el origen del clientDataJSON no es ${WEBAUTHN_ORIGIN}`;
  return null;
}

function checkAuthenticatorData(bytes) {
  if (bytes.length < MIN_AUTH_DATA) return `el authenticatorData mide ${bytes.length} bytes, menos de ${MIN_AUTH_DATA}`;
  if (!bytes.subarray(0, 32).equals(sha256(WEBAUTHN_RP_ID))) return `el authenticatorData no es de ${WEBAUTHN_RP_ID} (rpIdHash)`;
  if ((bytes[32] & FLAG_UP) === 0) return "el autenticador no atestigua la presencia del usuario (UP)";
  if ((bytes[32] & FLAG_UV) === 0) return "el autenticador no verificó al usuario (UV)";
  return null;
}

/** The credential's SPKI key, only when it is the key type its alg names. */
function credentialKey(publicKey, spec) {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyType === spec.keyType && key.asymmetricKeyDetails?.namedCurve === spec.curve ? key : null;
  } catch {
    return null;
  }
}

function checkSignature({ authenticatorData, clientDataJSON, signature }, credential) {
  const spec = ALGS.get(credential?.alg);
  if (!spec) return "el algoritmo de la credencial no es ES256 (-7) ni Ed25519 (-8)";
  const key = typeof credential.publicKey === "string" ? credentialKey(credential.publicKey, spec) : null;
  if (!key) return "la clave de la credencial no es una SPKI de su algoritmo";
  const data = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  let good = false;
  try {
    good = verify(spec.digest, data, spec.digest ? { key, dsaEncoding: "der" } : key, signature);
  } catch { /* a malformed signature is a signature that does not verify */ }
  return good ? null : "la firma no verifica con la clave de la credencial";
}

/**
 * @param {{assertion: {authenticatorData: string, clientDataJSON: string, signature: string},
 *   expectedChallenge: string, credential: {credentialId: string, publicKey: string, alg: number}}} input
 *   Assertion fields and challenge in base64url; publicKey is SPKI DER in base64.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function verifyWebAuthnAssertion({ assertion, expectedChallenge, credential } = {}) {
  if (typeof expectedChallenge !== "string" || !B64URL.test(expectedChallenge)) return { ok: false, reason: "falta el reto esperado (base64url)" };
  const decoded = decodeAssertion(assertion);
  if (!decoded) return { ok: false, reason: "la aserción no trae authenticatorData, clientDataJSON y signature en base64url" };
  const reason = checkClientData(decoded.clientDataJSON, expectedChallenge)
    ?? checkAuthenticatorData(decoded.authenticatorData)
    ?? checkSignature(decoded, credential);
  return reason ? { ok: false, reason } : { ok: true };
}
