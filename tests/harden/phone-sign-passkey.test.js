// HU-4016 (ADR 0053): kj asks for a passkey signature and records the webauthn block it gets.
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signAct } from "../../src/harden/act-sign.js";
import { canonicalPayload, readPasskeyCredentials, requestPhoneSignature, verifySignedFiles } from "../../src/harden/phone-sign.js";
import { lowerSecurityLevel, readSecurityLevel } from "../../src/harden/security-level.js";
import { passkey, passkeySigned } from "../_fixtures/passkey.js";

const FILES = [{ file: ".karajan/rules.yml", sha256: "ab".repeat(32) }];
const key = passkey("cred-1");
const s = (stringValue) => ({ stringValue });
let repo, home, t, posted;

/** A relay whose phone answers with `answer(challenge)`: the fields the signer page writes. */
const relay = (answer) => async (url, opts = {}) => {
  if (String(url).endsWith("/sign/relay.json")) return { ok: true, json: async () => ({ projectId: "p", apiKey: "k", collection: "c", payloadVersion: 2 }) };
  if (opts.method === "POST") { posted = JSON.parse(opts.body).fields; posted.cid = new URL(url).searchParams.get("documentId"); return { ok: true, json: async () => ({}) }; }
  const challenge = { cid: posted.cid, nonce: posted.nonce.stringValue, project: posted.project.stringValue, v: 2, kjVersion: posted.kj_version.stringValue,
    issuedMs: Date.parse(posted.createdAt.timestampValue), expiresMs: Date.parse(posted.expires_at.timestampValue) };
  const fields = { state: s("signed"), ...answer(challenge) };
  if (fields.late) { t = challenge.expiresMs + 1; delete fields.late; }
  return { ok: true, json: async () => ({ fields }) };
};
const passkeyAnswer = (by = key, tweak = {}, files = FILES) => (challenge) => {
  const b = { ...passkeySigned(by, files, challenge), ...tweak };
  return { credentialId: s(b.credentialId), authenticatorData: s(b.authenticatorData), clientDataJSON: s(b.clientDataJSON), signature: s(b.signature), late: tweak.late };
};
const request = (fetchFn, files = FILES) => requestPhoneSignature({
  project: "p", files, kjVersion: "9", logger: { info() {} },
  deps: { fetch: fetchFn, home, projectDir: repo, now: () => t, sleep: async (ms) => { t += ms; }, qr: () => {}, spinner: { tick() {}, stop() {} } },
});
const roster = (entries) => writeFileSync(join(repo, ".karajan", "supervisor-signers.json"), JSON.stringify({ signers: entries }));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-pk-")); home = mkdtempSync(join(tmpdir(), "kj-pk-home-"));
  mkdirSync(join(repo, ".karajan")); roster([key.entry]); t = 1_700_000_000_000; posted = null;
});
afterEach(() => { for (const dir of [repo, home]) rmSync(dir, { recursive: true, force: true }); });

describe("requestPhoneSignature with a passkey", () => {
  it("asks for the passkey only when the roster holds a live one", async () => {
    await request(relay(passkeyAnswer()));
    expect(posted.passkey).toEqual({ booleanValue: true });
    roster([]);
    await request(relay(() => ({}))).catch(() => {});
    expect(posted).not.toHaveProperty("passkey");
  });

  it("a passkey answer returns a webauthn block that the CI judge accepts", async () => {
    const res = await request(relay(passkeyAnswer()));
    expect(res).toMatchObject({ ok: true, block: { type: "webauthn", credentialId: "cred-1", v: 2 } });
    const provenance = { files: FILES, signature: res.block };
    expect(verifySignedFiles({ sig: provenance.signature, files: FILES, keys: new Set(), passkeys: readPasskeyCredentials({ projectDir: repo }) })).toEqual({ ok: true });
  });

  it.each([
    ["an unknown credential", () => passkeyAnswer(passkey("cred-2")), /no está en el padrón/],
    ["a tampered signature", () => passkeyAnswer(key, { signature: passkeySigned(passkey("cred-1"), FILES).signature }), /no vale/],
    ["a late answer", () => passkeyAnswer(key, { late: true }), /no vale|fuera de su vigencia/],
  ])("refuses %s", async (_name, make, reason) => {
    const res = await request(relay(make()));
    expect(res).toMatchObject({ ok: false });
    expect(res.reason).toMatch(reason);
  });

  it("an Ed25519 answer to a passkey request still returns today's block", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
    roster([key.entry, { publicKey: pub }]);
    const answer = (c) => ({ publicKey: s(pub), signature: s(cryptoSign(null, Buffer.from(canonicalPayload({ ...c, files: FILES }), "utf8"), privateKey).toString("base64")) });
    const res = await request(relay(answer));
    expect(res.block).toEqual({ ...res.challenge, signer: pub, signature: res.signature });
    expect(res.block).not.toHaveProperty("type");
  });

  it("refuses a revoked credential", async () => {
    roster([{ ...key.entry, revoked: true }]);
    expect((await request(relay(passkeyAnswer()))).ok).toBe(false);
  });
});

describe("the acts record the block", () => {
  const phone = () => ({ request: (req) => request(relay(passkeyAnswer(key, {}, req.files)), req.files) });

  it("signAct at max with a roster that holds only a passkey asks for it and returns the webauthn block", async () => {
    writeFileSync(join(repo, ".karajan", "security-level.json"), JSON.stringify({ level: "max", since: "2026-10-09" }));
    const res = await signAct("rules-approve", { projectDir: repo, home, kjVersion: "9", files: FILES, logger: { info() {}, warn() {} }, deps: { phone: phone() } });
    expect(res.signature).toMatchObject({ type: "webauthn", credentialId: "cred-1" });
  });

  it("the security level change records a webauthn block that readSecurityLevel verifies", async () => {
    const human = { env: {}, tty: true, deps: { confirm: (n) => n, ancestry: { pid: 100, readProc: () => ({ ppid: 1, cmd: "bash" }) } } };
    // The record's bytes are what the phone signs: the fake answers over the files kj asked for.
    const ask = (req) => request(relay(passkeyAnswer(key, {}, req.files)), req.files);
    await lowerSecurityLevel({ ...human, projectDir: repo, home, kjVersion: "9", logger: { info() {} }, deps: { ...human.deps, phone: { enrolled: () => true, request: ask } } });
    expect(readSecurityLevel({ projectDir: repo, home })).toEqual({ level: "normal", source: "file", signer: "cred-1", since: expect.any(String) });
  });
});
