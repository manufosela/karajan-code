// HU-4014 (ADR 0053): a roster passkey and the signature block it gives, REAL, built with
// node:crypto as an authenticator would: authenticatorData || sha256(clientDataJSON), signed.
import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { canonicalPayload } from "../../src/harden/phone-sign.js";

const sha = (data) => createHash("sha256").update(data).digest();
export const CHALLENGE = { cid: "c", nonce: "n", project: "p", v: 2, kjVersion: "9", issuedMs: 1, expiresMs: 2 };

/** A passkey and its roster entry: ES256 (-7) or Ed25519 (-8). */
export function passkey(credentialId = "cred-1", alg = -7) {
  const pair = alg === -8 ? generateKeyPairSync("ed25519") : generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { privateKey: pair.privateKey, entry: { type: "webauthn", credentialId, publicKey, alg } };
}

/** The webauthn signature block `key` gives over `files`, with kj's challenge fields. */
export function passkeySigned(key, files, challenge = CHALLENGE) {
  const expected = sha(canonicalPayload({ ...challenge, files })).toString("base64url");
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: expected, origin: "https://karajancode.com" }));
  const auth = Buffer.concat([sha("karajancode.com"), Buffer.from([0x05]), Buffer.alloc(4)]);
  const data = Buffer.concat([auth, sha(clientData)]);
  const signature = key.entry.alg === -8 ? sign(null, data, key.privateKey) : sign("sha256", data, { key: key.privateKey, dsaEncoding: "der" });
  const b64u = (buf) => buf.toString("base64url");
  return { ...challenge, type: "webauthn", credentialId: key.entry.credentialId, authenticatorData: b64u(auth), clientDataJSON: b64u(clientData), signature: b64u(signature) };
}
