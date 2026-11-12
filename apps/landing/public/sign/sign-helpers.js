// HU-3927 (ADR 0053): the signer page's pure helpers, a plain ES module tested
// under tests/landing/. It signs only from a phone, with a passkey whose
// challenge is the sha256 of kj's canonical payload (src/harden/phone-sign.js).
export const PASSKEY_RP_ID = "karajancode.com";
const PHONE_UA = /Android|iPhone|iPad|Mobi/;

/** A phone, or iPadOS (a Macintosh user agent with touch). A desktop browser is not. */
export const isPhone = ({ userAgentData, userAgent = "", maxTouchPoints = 0 } = {}) => {
  if (typeof userAgentData?.mobile === "boolean") return userAgentData.mobile;
  return PHONE_UA.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
};

const digest = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const sha256 = (text) => digest(new TextEncoder().encode(text));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const toBase64 = (buffer) => btoa(String.fromCodePoint(...new Uint8Array(buffer)));
const toBase64Url = (buffer) => toBase64(buffer).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

/** The same bytes as kj's canonicalPayload: v2 also signs the version and the validity (ms). */
export async function canonicalPayload({ cid, nonce, project, files, v2, kjVersion, issuedMs, expiresMs }) {
  const filesHash = toHex(await sha256(JSON.stringify(files)));
  return v2
    ? `kj-supervisor-sign:v2:${cid}:${nonce}:${project}:${kjVersion}:${issuedMs}:${expiresMs}:${filesHash}`
    : `kj-supervisor-sign:v1:${cid}:${nonce}:${project}:${filesHash}`;
}

export const passkeyChallenge = (payload) => sha256(payload);

/** The ordered ways to sign: the passkey only when kj's request accepts it (passkey: true). Empty: nothing signs here. */
export function signMethods({ docFields, hasEd25519Key, hasWebAuthn }) {
  if (docFields.passkey?.booleanValue !== true) return ["ed25519"];
  return [hasWebAuthn && "passkey", hasEd25519Key && "ed25519"].filter(Boolean);
}

/** No allowCredentials: the passkey is discoverable; each signature asks for the person. */
export const passkeyRequest = (challenge) => ({ challenge, rpId: PASSKEY_RP_ID, userVerification: "required", timeout: 120_000 });

/** The relay doc's fields for a passkey assertion, in base64url as kj's verifier reads them. */
export function passkeyFields(credential, signedAt) {
  const { authenticatorData, clientDataJSON, signature } = credential.response;
  return {
    state: { stringValue: "signed" },
    authenticatorData: { stringValue: toBase64Url(authenticatorData) },
    clientDataJSON: { stringValue: toBase64Url(clientDataJSON) },
    signature: { stringValue: toBase64Url(signature) },
    credentialId: { stringValue: toBase64Url(credential.rawId) },
    signedAt: { timestampValue: signedAt },
  };
}

/** HU-3976: a relay doc with kind "register" asks for a new passkey; any other is a signing request, as before. */
export const requestKind = (docFields) => (docFields.kind?.stringValue === "register" ? "register" : "sign");

/** The creation options of a register request: the challenge is the sha256 of the request's nonce bytes. */
export async function registerRequest({ nonceBytes, userLabel, userIdBytes }) {
  if (typeof userLabel !== "string" || !userLabel.trim()) throw new Error("register request: the user label is empty");
  if (!(userIdBytes instanceof Uint8Array) || userIdBytes.length !== 16) throw new Error("register request: the user id must be 16 bytes");
  return {
    challenge: await digest(nonceBytes),
    rp: { id: PASSKEY_RP_ID, name: "Karajan" },
    user: { id: userIdBytes, name: userLabel, displayName: userLabel },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -8 }],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    attestation: "none",
    timeout: 120_000,
  };
}

/** The relay doc's fields for a new passkey: credential id in base64url, public key as base64 SPKI. */
export function registerFields(credential, signedAt = new Date().toISOString()) {
  const spki = credential.response.getPublicKey();
  if (!spki) throw new Error("register: the authenticator returned no public key");
  return {
    state: { stringValue: "registered" },
    credentialId: { stringValue: toBase64Url(credential.rawId) },
    publicKey: { stringValue: toBase64(spki) },
    alg: { integerValue: String(credential.response.getPublicKeyAlgorithm()) },
    signedAt: { timestampValue: signedAt },
  };
}
