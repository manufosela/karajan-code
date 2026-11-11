// HU-3927 (ADR 0053): the signer page's pure helpers. It signs only from a phone, with a
// passkey whose challenge is the sha256 of the same canonical payload kj builds.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalPayload as kjPayload } from "../../src/harden/phone-sign.js";
import { canonicalPayload, isPhone, passkeyChallenge, passkeyFields, passkeyRequest, signMethods } from "../../apps/landing/public/sign/sign-helpers.js";

const DESKTOP_CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("isPhone", () => {
  it("trusts userAgentData.mobile when the browser gives it", () => {
    expect(isPhone({ userAgentData: { mobile: true }, userAgent: DESKTOP_CHROME })).toBe(true);
    expect(isPhone({ userAgentData: { mobile: false }, userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile" })).toBe(false);
  });

  it("falls back to the user agent: Android, iPhone, iPad and Mobi are phones, a desktop is not", () => {
    for (const ua of ["Mozilla/5.0 (Linux; Android 15; Pixel 9)", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "Mozilla/5.0 (X11) Gecko Firefox/130 Mobi"]) {
      expect(isPhone({ userAgent: ua, maxTouchPoints: 5 }), ua).toBe(true);
    }
    expect(isPhone({ userAgent: DESKTOP_CHROME, maxTouchPoints: 0 })).toBe(false);
  });

  it("counts iPadOS (a Macintosh user agent with touch) as a phone, and a real Mac as not", () => {
    expect(isPhone({ userAgent: MAC_SAFARI, maxTouchPoints: 5 })).toBe(true);
    expect(isPhone({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe(false);
  });
});

describe("the passkey challenge", () => {
  const files = [{ file: ".karajan/hooks/pre-commit", sha256: "ab".repeat(32) }];
  const base = { cid: "0".repeat(32), nonce: "n1", project: "p", files };

  it("builds the same v1 and v2 payload bytes as kj's canonicalPayload", async () => {
    expect(await canonicalPayload({ ...base, v2: false })).toBe(kjPayload(base));
    const v2 = { kjVersion: "9.9.9", issuedMs: 1_700_000_000_000, expiresMs: 1_700_000_600_000 };
    expect(await canonicalPayload({ ...base, v2: true, ...v2 })).toBe(kjPayload({ ...base, v: 2, ...v2 }));
  });

  it("is the sha256 of the payload bytes", async () => {
    const challenge = await passkeyChallenge(kjPayload(base));
    expect(Buffer.from(challenge).equals(createHash("sha256").update(kjPayload(base)).digest())).toBe(true);
  });

  it("asks for a discoverable credential of karajancode.com with user verification", () => {
    const req = passkeyRequest(new Uint8Array(32));
    expect(req).toMatchObject({ challenge: new Uint8Array(32), rpId: "karajancode.com", userVerification: "required", timeout: 120_000 });
    expect(req).not.toHaveProperty("allowCredentials");
  });
});

describe("passkeyFields", () => {
  const bytes = (...b) => new Uint8Array(b).buffer;
  const credential = {
    rawId: bytes(251, 255, 0),
    response: { authenticatorData: bytes(1, 2, 3), clientDataJSON: new TextEncoder().encode('{"type":"webauthn.get"}').buffer, signature: bytes(250, 251, 252, 253) },
  };

  it("PATCHes state signed, the assertion and the credential id in base64url, and signedAt", () => {
    expect(passkeyFields(credential, "2026-11-11T10:00:00.000Z")).toEqual({
      state: { stringValue: "signed" },
      authenticatorData: { stringValue: "AQID" },
      clientDataJSON: { stringValue: Buffer.from('{"type":"webauthn.get"}').toString("base64url") },
      signature: { stringValue: "-vv8_Q" },
      credentialId: { stringValue: "-_8A" },
      signedAt: { timestampValue: "2026-11-11T10:00:00.000Z" },
    });
  });
});

// HU-3927: the passkey is offered only when kj's request accepts it (passkey: true).
it("signMethods: no flag is Ed25519 as before; the flag puts the passkey first if WebAuthn is there", () => {
  const flag = { passkey: { booleanValue: true } };
  const methods = (docFields, hasEd25519Key, hasWebAuthn) => signMethods({ docFields, hasEd25519Key, hasWebAuthn });
  expect(methods({}, true, true)).toEqual(["ed25519"]);
  expect(methods({ passkey: { booleanValue: false } }, false, true)).toEqual(["ed25519"]);
  expect(methods(flag, true, true)).toEqual(["passkey", "ed25519"]);
  expect(methods(flag, false, true)).toEqual(["passkey"]);
  expect(methods(flag, true, false)).toEqual(["ed25519"]);
  expect(methods(flag, false, false)).toEqual([]); // nothing signs here: the page says so
});
