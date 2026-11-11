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

const sha256 = async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const toBase64Url = (buffer) => btoa(String.fromCodePoint(...new Uint8Array(buffer)))
  .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

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
