// KJC-TSK-0822 (PRP-0023) — capa 5 del sello del supervisor: firma ed25519
// desde el móvil. La clave privada JAMÁS toca esta máquina: aquí se prueba el
// núcleo — payload canónico byte-estable, enrolamiento validado y verificación
// contra una firma REAL generada con node:crypto.
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canonicalPayload, enrollPhone, isPhoneEnrolled, readEnrolledKey, verifyPhoneSignature,
} from "../../src/harden/phone-sign.js";

const FILES = [
  { file: ".karajan/hooks/pre-commit", sha256: "ab".repeat(32) },
  { file: ".karajan/hooks/pre-push", sha256: "cd".repeat(32) },
];
const CID = "00112233445566778899aabbccddeeff";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const rawPub = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const signPayload = (payload, key = privateKey) => cryptoSign(null, Buffer.from(payload, "utf8"), key).toString("base64");

let home;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "kj-phone-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("phone-sign core (KJC-TSK-0822)", () => {
  it("canonical payload is byte-stable for a fixed case", () => {
    expect(canonicalPayload({ cid: CID, nonce: "cafebabe", project: "karajan-code", files: FILES })).toBe(
      `kj-supervisor-sign:v1:${CID}:cafebabe:karajan-code:e9c991f428490467c3e17bd131444bc350f49957e7ca24c16ac2b9bdfe0c159d`,
    );
  });

  it("enroll validates base64 of EXACTLY 32 bytes and persists the key", () => {
    for (const bad of ["", "no es base64!!", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64")]) {
      expect(() => enrollPhone(bad, { home })).toThrow(/32 bytes/);
    }
    expect(isPhoneEnrolled({ home })).toBe(false);
    enrollPhone(rawPub, { home });
    expect(isPhoneEnrolled({ home })).toBe(true);
    expect(readEnrolledKey({ home })).toBe(rawPub);
    expect(JSON.parse(readFileSync(join(home, ".karajan", "supervisor-phone.json"), "utf8")).enrolledAt).toBeTruthy();
  });

  it("accepts a REAL ed25519 signature over the canonical payload", () => {
    const payload = canonicalPayload({ cid: CID, nonce: "cafebabe", project: "karajan-code", files: FILES });
    expect(verifyPhoneSignature({ payload, signature: signPayload(payload), publicKey: rawPub })).toBe(true);
  });

  it("rejects a tampered signature and a signature from another key", () => {
    const payload = canonicalPayload({ cid: CID, nonce: "cafebabe", project: "karajan-code", files: FILES });
    const sig = Buffer.from(signPayload(payload), "base64");
    sig[0] ^= 1;
    expect(verifyPhoneSignature({ payload, signature: sig.toString("base64"), publicKey: rawPub })).toBe(false);
    const other = generateKeyPairSync("ed25519");
    expect(verifyPhoneSignature({ payload, signature: signPayload(payload, other.privateKey), publicKey: rawPub })).toBe(false);
  });

  it("rejects a valid signature over a DIFFERENT payload (files reordered)", () => {
    const payload = canonicalPayload({ cid: CID, nonce: "cafebabe", project: "karajan-code", files: FILES });
    const reordered = canonicalPayload({ cid: CID, nonce: "cafebabe", project: "karajan-code", files: FILES.toReversed() });
    expect(reordered).not.toBe(payload);
    expect(verifyPhoneSignature({ payload: reordered, signature: signPayload(payload), publicKey: rawPub })).toBe(false);
  });
});
