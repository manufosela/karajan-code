// HU-3919 (KJC-TSK-1530, ADR 0053): kj and CI verify a WebAuthn assertion against a
// roster passkey. The assertions are REAL, built here with node:crypto as an
// authenticator would: authenticatorData || sha256(clientDataJSON), signed.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readPasskeyCredentials, readSigners } from "../../src/harden/phone-sign.js";
import { WEBAUTHN_ORIGIN, WEBAUTHN_RP_ID, verifyWebAuthnAssertion } from "../../src/harden/webauthn-verify.js";

// Literal, not imported: the exported constants are under test too.
const RP_ID = "karajancode.com";
const ORIGIN = "https://karajancode.com";
const sha = (data) => createHash("sha256").update(data).digest();
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const CHALLENGE = b64u(sha("kj-supervisor-sign:v2:cid:nonce:karajan-code:5.15.0:1:2:abc"));
const P256 = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ED = generateKeyPairSync("ed25519");
const spki = (pair) => pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const credentialOf = (pair, alg) => ({ credentialId: "cred-1", publicKey: spki(pair), alg });

/** An assertion as an authenticator returns it; every field can be bent for one case. */
function assertion({ pair = P256, alg = -7, client = {}, rawClient, rpHash = sha(RP_ID), flags = 0x05, authData } = {}) {
  const clientData = Buffer.from(rawClient ?? JSON.stringify({ type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN, ...client }));
  const auth = authData ?? Buffer.concat([rpHash, Buffer.from([flags]), Buffer.alloc(4)]);
  const data = Buffer.concat([auth, sha(clientData)]);
  const signature = alg === -8 ? sign(null, data, pair.privateKey) : sign("sha256", data, { key: pair.privateKey, dsaEncoding: "der" });
  return { authenticatorData: b64u(auth), clientDataJSON: b64u(clientData), signature: b64u(signature) };
}

const check = (a, credential = credentialOf(P256, -7), expectedChallenge = CHALLENGE) =>
  verifyWebAuthnAssertion({ assertion: a, expectedChallenge, credential });

describe("verifyWebAuthnAssertion (HU-3919)", () => {
  it("accepts a valid ES256 and a valid Ed25519 assertion, whatever the counter", () => {
    expect([WEBAUTHN_RP_ID, WEBAUTHN_ORIGIN]).toEqual([RP_ID, ORIGIN]);
    expect(check(assertion())).toEqual({ ok: true });
    expect(check(assertion({ pair: ED, alg: -8 }), credentialOf(ED, -8))).toEqual({ ok: true });
  });

  it("gives each failed check its own reason", () => {
    const tampered = assertion();
    const sig = Buffer.from(tampered.signature, "base64url");
    sig[sig.length - 1] ^= 0xff;
    const cases = {
      malformedClient: check(assertion({ rawClient: "{not json" })),
      wrongType: check(assertion({ client: { type: "webauthn.create" } })),
      wrongChallenge: check(assertion({ client: { challenge: b64u(sha("another payload")) } })),
      wrongOrigin: check(assertion({ client: { origin: "https://evil.example" } })),
      shortAuthData: check(assertion({ authData: Buffer.alloc(36) })),
      wrongRpIdHash: check(assertion({ rpHash: sha("evil.example") })),
      noUserPresence: check(assertion({ flags: 0x04 })),
      noUserVerification: check(assertion({ flags: 0x01 })),
      unknownAlg: check(assertion(), { ...credentialOf(P256, -7), alg: -257 }),
      badSignature: check({ ...tampered, signature: b64u(sig) }),
    };
    for (const [name, result] of Object.entries(cases)) expect(result, name).toEqual({ ok: false, reason: expect.any(String) });
    expect(new Set(Object.values(cases).map((r) => r.reason)).size).toBe(Object.keys(cases).length);
  });

  it("refuses another key's signature, a key off its alg, and incomplete input, without crashing", () => {
    const results = [check(assertion({ pair: generateKeyPairSync("ec", { namedCurve: "P-256" }) })),
      check(assertion({ pair: ED, alg: -8 }), credentialOf(ED, -7)), check(assertion(), { ...credentialOf(P256, -7), publicKey: undefined }),
      check(assertion({ client: { challenge: undefined } }), undefined, undefined),
      check({ ...assertion(), signature: undefined }), check(assertion({ rawClient: "null" }))];
    expect(results.map((r) => r.ok)).toEqual(Array(6).fill(false));
  });
});

describe("roster with passkeys (HU-3919)", () => {
  it("returns only the non-revoked passkeys, and readSigners keeps only the Ed25519 keys", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kj-passkey-"));
    const edKey = ED.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
    const passkey = { type: "webauthn", credentialId: "cred-1", publicKey: spki(P256), alg: -7, label: "phone" };
    const signers = [
      { publicKey: edKey, label: "old phone" },
      { publicKey: "revoked-ed25519", revoked: { at: "2026-11-11T00:00:00Z" } },
      passkey,
      { ...passkey, credentialId: "cred-2", revoked: { at: "2026-11-11T00:00:00Z" } },
    ];
    mkdirSync(join(projectDir, ".karajan"));
    writeFileSync(join(projectDir, ".karajan", "supervisor-signers.json"), JSON.stringify({ signers }));
    try {
      expect(readPasskeyCredentials({ projectDir })).toEqual([{ credentialId: "cred-1", publicKey: spki(P256), alg: -7, label: "phone" }]);
      expect(readSigners({ projectDir })).toEqual([edKey]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
