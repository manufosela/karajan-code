// HU-4014 (ADR 0053): verifySignedFiles judges a webauthn signature block against the
// roster's live passkeys, with every check of the Ed25519 path that applies.
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalPayload, readPasskeyCredentials, verifySignedFiles } from "../../src/harden/phone-sign.js";
import { CHALLENGE, passkey, passkeySigned } from "../_fixtures/passkey.js";

const FILES = [{ file: ".karajan/hooks/pre-commit", sha256: "a".repeat(64) }];
const es256 = passkey("cred-es", -7);
const ed = passkey("cred-ed", -8);
const passkeys = [es256.entry, ed.entry];
const check = (sig, files = FILES, list = passkeys) => verifySignedFiles({ sig, files, keys: new Set(), passkeys: list });

describe("verifySignedFiles with a passkey (HU-4014)", () => {
  it("accepts a valid ES256 and a valid Ed25519 passkey block over the files it declares", () => {
    expect(check(passkeySigned(es256, FILES))).toEqual({ ok: true });
    expect(check(passkeySigned(ed, FILES))).toEqual({ ok: true });
  });

  it("rejects the wrong files, an unknown credential, a tampered signature and a revived expired block", () => {
    const good = passkeySigned(es256, FILES);
    const sig = Buffer.from(good.signature, "base64url");
    sig[sig.length - 1] ^= 0xff;
    const cases = [
      [check(good, [{ ...FILES[0], sha256: "b".repeat(64) }]), /no corresponde a los ficheros/],
      [check({ ...good, credentialId: "cred-unknown" }), /passkey que no está en el padrón/],
      [check(good, FILES, [ed.entry]), /passkey que no está en el padrón/],
      [check({ ...good, signature: sig.toString("base64url") }), /no corresponde/],
      [check({ ...good, expiresMs: CHALLENGE.expiresMs + 600000 }), /no corresponde/],
      [check({ ...good, credentialId: undefined }, FILES, [{ ...es256.entry, credentialId: undefined }]), /no está en el padrón/],
    ];
    for (const [result, reason] of cases) expect(result).toEqual({ ok: false, reason: expect.stringMatching(reason) });
  });

  it("a revoked passkey of the roster does not sign", () => {
    const dir = mkdtempSync(join(tmpdir(), "kj-passkey-"));
    mkdirSync(join(dir, ".karajan"));
    const revoked = { ...es256.entry, revoked: { at: "2026-11-12T00:00:00Z", recoveryProof: "x" } };
    writeFileSync(join(dir, ".karajan", "supervisor-signers.json"), JSON.stringify({ signers: [revoked, ed.entry] }));
    const live = readPasskeyCredentials({ projectDir: dir });
    rmSync(dir, { recursive: true, force: true });
    expect(check(passkeySigned(es256, FILES), FILES, live)).toMatchObject({ ok: false, reason: expect.stringMatching(/no está en el padrón/) });
    expect(check(passkeySigned(ed, FILES), FILES, live)).toEqual({ ok: true });
  });

  it("an Ed25519 block verifies exactly as before, and passkeys do not stand in for keys", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const signer = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
    const block = { ...CHALLENGE, signer, signature: sign(null, Buffer.from(canonicalPayload({ ...CHALLENGE, files: FILES })), privateKey).toString("base64") };
    expect(verifySignedFiles({ sig: block, files: FILES, keys: new Set([signer]) })).toEqual({ ok: true });
    expect(check(block)).toMatchObject({ ok: false, reason: expect.stringMatching(/clave que no está en el padrón/) });
    expect(verifySignedFiles({ sig: undefined, files: FILES, keys: new Set([signer]) })).toEqual({ ok: false, reason: "no lleva firma" });
  });
});
