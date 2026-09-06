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
  canonicalPayload, enrollPhone, isPhoneEnrolled, readEnrolledKey, requestPhoneSignature, verifyPhoneSignature,
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

// Móvil falso: captura cid+nonce de la petición publicada y firma como la app.
const fakePhone = ({ key = privateKey, pub = rawPub, state = "signed", mangle = (s) => s } = {}) => {
  const seen = {};
  return async (url, opts = {}) => {
    if (opts.method === "POST") {
      seen.cid = new URL(url).searchParams.get("documentId");
      seen.nonce = JSON.parse(opts.body).fields.nonce.stringValue;
      return { ok: true, json: async () => ({}) };
    }
    const payload = canonicalPayload({ cid: seen.cid, nonce: seen.nonce, project: "karajan-code", files: FILES });
    const fields = state === "signed"
      ? { state: { stringValue: "signed" }, signature: { stringValue: mangle(signPayload(payload, key)) }, publicKey: { stringValue: pub } }
      : { state: { stringValue: state } };
    return { ok: true, json: async () => ({ fields }) };
  };
};

describe("requestPhoneSignature (KJC-TSK-0822)", () => {
  let t;
  beforeEach(() => { t = 0; });
  const request = (fetchFn) => requestPhoneSignature({
    project: "karajan-code", files: FILES, kjVersion: "9.9.9", logger: { info: () => {} },
    deps: { fetch: fetchFn, home, now: () => t, sleep: async (ms) => { t += ms; }, qr: () => {} },
  });

  it("accepts a REAL signature from the enrolled key over the published cid+nonce", async () => {
    enrollPhone(rawPub, { home });
    await expect(request(fakePhone())).resolves.toEqual({ ok: true });
  });

  it("rejects a tampered signature", async () => {
    enrollPhone(rawPub, { home });
    const mangle = (s) => { const b = Buffer.from(s, "base64"); b[0] ^= 1; return b.toString("base64"); };
    const res = await request(fakePhone({ mangle }));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/firma/);
  });

  it("rejects a doc publicKey that is not the ENROLLED one — even with a valid signature", async () => {
    enrollPhone(rawPub, { home });
    const other = generateKeyPairSync("ed25519");
    const otherPub = other.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
    const res = await request(fakePhone({ key: other.privateKey, pub: otherPub }));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/enrolada/);
  });

  it("expires after 120s of pending state", async () => {
    enrollPhone(rawPub, { home });
    await expect(request(fakePhone({ state: "pending" }))).resolves.toEqual({ ok: false, reason: "caducado" });
    expect(t).toBeGreaterThanOrEqual(120000);
  });

  it("a dead network fails loudly — no silent fallback", async () => {
    enrollPhone(rawPub, { home });
    await expect(request(async () => ({ ok: false, status: 503 }))).rejects.toThrow(/503/);
  });
});
