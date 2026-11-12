// KJC-TSK-0965 (HUM-B, ADR 0018): a phone enters signed by a present one or with the one-time recovery code.
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalPayload, readPasskeyCredentials, readSigners } from "../../src/harden/phone-sign.js";
import { admissionFiles, admitSigner, issueRecoveryCode, readRoster, redeemRecoveryCode, SIGNERS_FILE, verifyRosterChange } from "../../src/harden/roster.js";
import { passkey as passkeyKey, passkeySigned } from "../_fixtures/passkey.js";

const keyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"), privateKey };
};
const sha = (text) => createHash("sha256").update(text).digest("hex");
/** The admission a present phone `by` gives to `publicKey`, as signAct records it. */
const signedBy = (by, publicKey) => {
  const challenge = { cid: "c", nonce: "n", project: "p", v: 2, kjVersion: "9", issuedMs: 1, expiresMs: 2 };
  const signature = cryptoSign(null, Buffer.from(canonicalPayload({ ...challenge, files: admissionFiles(publicKey) }), "utf8"), by.privateKey).toString("base64");
  return { ...challenge, signer: by.pub, signature };
};
const a = keyPair();
const b = keyPair();
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-roster-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const admit = (opts) => admitSigner({ projectDir: dir, ...opts });

describe("the recovery code", () => {
  it("is 100 random bits in a readable form, kept as a double sha256 fingerprint, and never the same twice", () => {
    const one = issueRecoveryCode();
    expect(one.code).toMatch(/^kjrc(-[a-z2-7]{5}){4}$/);
    expect(one.fingerprint).toBe(sha(sha(one.code)));
    expect(issueRecoveryCode().code).not.toBe(one.code);
  });

  it("is issued once at the first enrollment, shown once, and redeemed only when it matches", () => {
    const first = admit({ publicKey: a.pub, label: "a" });
    expect(first.recoveryCode).toMatch(/^kjrc-/);
    expect(readFileSync(join(dir, SIGNERS_FILE), "utf8")).not.toContain(first.recoveryCode);
    expect(readRoster({ projectDir: dir })).toMatchObject({ signers: [{ publicKey: a.pub, label: "a" }], recovery: { fingerprint: sha(sha(first.recoveryCode)) } });
    expect(admit({ publicKey: a.pub }).recoveryCode).toBeNull(); // already present: nothing changes
    expect(() => redeemRecoveryCode("nope", { projectDir: dir })).toThrow(/formato kjrc-/);
    expect(() => redeemRecoveryCode(issueRecoveryCode().code, { projectDir: dir })).toThrow(/no es el de este padrón/);
    expect(redeemRecoveryCode(first.recoveryCode, { projectDir: dir })).toEqual({ recoveryProof: sha(first.recoveryCode) });
  });

  it("a second phone needs an admission; spending the code records its proof, never the code, and issues a new one", () => {
    const first = admit({ publicKey: a.pub });
    expect(() => admit({ publicKey: b.pub })).toThrow(/firmado por uno del padrón o con el código/);
    const second = admit({ publicKey: b.pub, admission: redeemRecoveryCode(first.recoveryCode, { projectDir: dir }) });
    expect(second.recoveryCode).toMatch(/^kjrc-/);
    expect(second.recoveryCode).not.toBe(first.recoveryCode);
    expect(readFileSync(join(dir, SIGNERS_FILE), "utf8")).not.toContain(first.recoveryCode);
    expect(readRoster({ projectDir: dir })).toMatchObject({ signers: [{ publicKey: a.pub }, { publicKey: b.pub, admission: { recoveryProof: sha(first.recoveryCode) } }], recovery: { fingerprint: sha(sha(second.recoveryCode)) } });
    // KJC-TSK-0999: replacing revokes the lost phone with the same code; only with the code, only a present phone
    expect(() => admit({ publicKey: keyPair().pub, admission: signedBy(a, b.pub), replaces: a.pub })).toThrow(/se hace con el código/);
    const third = keyPair();
    expect(() => admit({ publicKey: third.pub, admission: redeemRecoveryCode(second.recoveryCode, { projectDir: dir }), replaces: keyPair().pub })).toThrow(/no está en el padrón/);
    admit({ publicKey: third.pub, admission: redeemRecoveryCode(second.recoveryCode, { projectDir: dir }), replaces: b.pub });
    expect(readRoster({ projectDir: dir }).signers[1]).toMatchObject({ publicKey: b.pub, revoked: { recoveryProof: sha(second.recoveryCode) } });
    // a roster from before the code (no recovery) gets one when a signed phone enters
    writeFileSync(join(dir, SIGNERS_FILE), JSON.stringify({ signers: readRoster({ projectDir: dir }).signers }));
    expect(() => redeemRecoveryCode(second.recoveryCode, { projectDir: dir })).toThrow(/no tiene código de recuperación/);
    const c = keyPair();
    expect(admit({ publicKey: c.pub, admission: signedBy(a, c.pub) }).recoveryCode).toMatch(/^kjrc-/);
  });
});

describe("verifyRosterChange (CI)", () => {
  const code = issueRecoveryCode();
  const proof = sha(code.code);
  const one = { signers: [{ publicKey: a.pub }], recovery: { fingerprint: code.fingerprint } };

  it("accepts the first roster, a key signed by a present one, and a key backed by the code's proof with a new fingerprint", () => {
    expect(verifyRosterChange({ before: null, after: one })).toMatchObject({ ok: true, bootstrap: true });
    for (const after of [{ ...one, signers: [...one.signers, { publicKey: b.pub }] }, { signers: one.signers }]) expect(verifyRosterChange({ before: null, after })).toMatchObject({ ok: false, reason: /el primer padrón lleva UN móvil/ });
    const signed = { ...one, signers: [...one.signers, { publicKey: b.pub, admission: signedBy(a, b.pub) }] };
    expect(verifyRosterChange({ before: one, after: signed })).toEqual({ ok: true, added: 1, spent: false });
    const redeemed = { signers: [...one.signers, { publicKey: b.pub, admission: { recoveryProof: proof } }], recovery: { fingerprint: issueRecoveryCode().fingerprint } };
    expect(verifyRosterChange({ before: one, after: redeemed })).toEqual({ ok: true, added: 1, spent: true });
    // KJC-TSK-0999: the lost phone is revoked by the same spent code; a revoked phone admits nobody afterwards
    const replaced = { ...redeemed, signers: [{ publicKey: a.pub, revoked: { recoveryProof: proof } }, redeemed.signers[1]] };
    expect(verifyRosterChange({ before: one, after: replaced })).toEqual({ ok: true, added: 1, spent: true });
    const c = keyPair();
    expect(verifyRosterChange({ before: replaced, after: { ...replaced, signers: [...replaced.signers, { publicKey: c.pub, admission: signedBy(a, c.pub) }] } })).toMatchObject({ ok: false, reason: /no está en el padrón/ });
    expect(verifyRosterChange({ before: replaced, after: { ...replaced, signers: [...replaced.signers, { publicKey: c.pub, admission: signedBy(b, c.pub) }] } })).toEqual({ ok: true, added: 1, spent: false });
    expect(verifyRosterChange({ before: replaced, after: { ...replaced, signers: [{ publicKey: a.pub }, replaced.signers[1]] } })).toMatchObject({ ok: false, reason: /estaba revocada y una revocación no se deshace/ });
    expect(verifyRosterChange({ before: one, after: one })).toEqual({ ok: true, added: 0, spent: false });
  });

  it("refuses a key without a valid admission, a stranger's signature, a copied fingerprint, a reused code, a removal and a silent rotation", () => {
    const stranger = keyPair();
    const cases = [
      [{ ...one, signers: [...one.signers, { publicKey: b.pub }] }, /entra sin admisión válida: no lleva firma/],
      [{ ...one, signers: [...one.signers, { publicKey: b.pub, admission: signedBy(stranger, b.pub) }] }, /clave que no está en el padrón/],
      [{ ...one, signers: [...one.signers, { publicKey: b.pub, admission: signedBy(a, stranger.pub) }] }, /no corresponde/],
      [{ signers: [...one.signers, { publicKey: b.pub, admission: { recoveryProof: code.fingerprint } }], recovery: { fingerprint: "x" } }, /no es el del padrón anterior/],
      [{ ...one, signers: [...one.signers, { publicKey: b.pub, admission: { recoveryProof: proof } }] }, /no trae la huella de uno nuevo/],
      [{ signers: [...one.signers, { publicKey: b.pub, admission: { recoveryProof: proof } }] }, /no trae la huella de uno nuevo/],
      [{ signers: one.signers }, /cambia sin que se haya gastado/],
      [{ signers: [...one.signers, { publicKey: b.pub, admission: { recoveryProof: proof } }, { publicKey: stranger.pub, admission: { recoveryProof: proof } }], recovery: { fingerprint: "y" } }, /admite UNA clave/],
      [{ signers: [], recovery: one.recovery }, /pierde la clave .*: una baja no tiene mecanismo/],
      [{ ...one, recovery: { fingerprint: "z" } }, /cambia sin que se haya gastado/],
      [{ ...one, signers: [{ publicKey: a.pub, revoked: { recoveryProof: "stolen" } }] }, /se revoca sin el código de recuperación/],
      [{ signers: [{ publicKey: a.pub, revoked: { recoveryProof: proof } }, { publicKey: b.pub, revoked: { recoveryProof: proof } }], recovery: { fingerprint: "w" } }, /revoca UN móvil/],
      [{ ...one, signers: [...one.signers, { publicKey: "not-a-key", admission: signedBy(a, "not-a-key") }] }, /no es una clave ed25519 válida/],
    ];
    expect(verifyRosterChange({ before: { signers: one.signers }, after: { signers: [...one.signers, { publicKey: b.pub, admission: signedBy(a, b.pub) }] } })).toMatchObject({ ok: false, reason: /falta cuando entra un móvil/ });
    for (const [after, reason] of cases) expect(verifyRosterChange({ before: one, after }), reason.source).toMatchObject({ ok: false, reason });
  });
});

// HU-3987 (KJC-TSK-1532, ADR 0053): CI judges a passkey entry before kj writes any.
describe("verifyRosterChange with passkey entries (CI)", () => {
  const code = issueRecoveryCode();
  const one = { signers: [{ publicKey: a.pub }], recovery: { fingerprint: code.fingerprint } };
  const spki = (pair) => pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const P256 = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ED = generateKeyPairSync("ed25519");
  const passkey = (over = {}) => ({ type: "webauthn", credentialId: "cred-1", publicKey: spki(P256), alg: -7, label: "phone", enrolledAt: "2026-11-12T00:00:00Z", ...over });
  const signedIn = (entry) => ({ ...one, signers: [...one.signers, { ...entry, admission: signedBy(a, entry.publicKey) }] });

  it("accepts a passkey as the first roster, admitted with the recovery code, or signed by a present Ed25519 signer", () => {
    for (const entry of [passkey(), passkey({ publicKey: spki(ED), alg: -8 })]) {
      expect(verifyRosterChange({ before: null, after: { signers: [entry], recovery: one.recovery } })).toEqual({ ok: true, bootstrap: true });
    }
    const redeemed = { signers: [...one.signers, { ...passkey(), admission: { recoveryProof: sha(code.code) } }], recovery: { fingerprint: issueRecoveryCode().fingerprint } };
    expect(verifyRosterChange({ before: one, after: redeemed })).toEqual({ ok: true, added: 1, spent: true });
    expect(verifyRosterChange({ before: one, after: signedIn(passkey()) })).toEqual({ ok: true, added: 1, spent: false });
  });

  it("refuses a wrong alg, a key off its alg, an empty credentialId, a non-SPKI key and an unknown type, first or added", () => {
    const cases = [
      [passkey({ alg: -257 }), /no es una passkey válida: .*algoritmo/],
      [passkey({ alg: -8 }), /no es una passkey válida: .*no es del tipo de su algoritmo/],
      [passkey({ credentialId: "" }), /no es una passkey válida: .*credentialId/],
      [passkey({ publicKey: b.pub }), /no es una passkey válida: .*no es una SPKI/],
      [passkey({ type: "x509" }), /tiene un tipo desconocido/],
    ];
    for (const [entry, reason] of cases) {
      expect(verifyRosterChange({ before: null, after: { signers: [entry], recovery: one.recovery } }), reason.source).toMatchObject({ ok: false, reason: new RegExp(`el primer padrón lleva UN móvil.*${reason.source}`) });
      expect(verifyRosterChange({ before: one, after: signedIn(entry) }), reason.source).toMatchObject({ ok: false, reason });
    }
  });

  it("judges every entry, not only the new ones, and a known key keeps its type and credential", () => {
    const pk = passkey();
    const withPasskey = { ...one, signers: [...one.signers, pk] };
    const rewritten = [
      [one, [{ publicKey: a.pub, type: "webauthn", credentialId: "cred-1", alg: -7 }]], // a known Ed25519 signer rewritten as an invalid passkey
      [withPasskey, [one.signers[0], { ...pk, credentialId: "cred-2" }]],
      [withPasskey, [one.signers[0], { ...pk, alg: -8 }]],
    ];
    for (const [before, signers] of rewritten) expect(verifyRosterChange({ before, after: { ...before, signers } })).toMatchObject({ ok: false, reason: /cambia de tipo o de credencial/ });
    expect(verifyRosterChange({ before: withPasskey, after: { ...withPasskey, signers: [one.signers[0], { ...pk, label: "renamed" }] } })).toEqual({ ok: true, added: 0, spent: false });
    const broken = { ...one, signers: [...one.signers, { ...pk, alg: -257 }] }; // written outside CI
    expect(verifyRosterChange({ before: broken, after: broken })).toMatchObject({ ok: false, reason: /no es una passkey válida: .*algoritmo/ });
  });

  it("HU-4014: a present passkey admits a new key; a forged or revoked one admits nobody", () => {
    const key = passkeyKey("cred-present");
    const c = keyPair();
    const withKey = { ...one, signers: [...one.signers, key.entry] };
    const admitted = (before, signedFor = c.pub) => ({ ...before, signers: [...before.signers, { publicKey: c.pub, admission: passkeySigned(key, admissionFiles(signedFor)) }] });
    expect(verifyRosterChange({ before: withKey, after: admitted(withKey) })).toEqual({ ok: true, added: 1, spent: false });
    expect(verifyRosterChange({ before: withKey, after: admitted(withKey, b.pub) })).toMatchObject({ ok: false, reason: /entra sin admisión válida: .*no corresponde/ });
    const revoked = { ...one, signers: [...one.signers, { ...key.entry, revoked: { recoveryProof: "x" } }] };
    expect(verifyRosterChange({ before: revoked, after: admitted(revoked) })).toMatchObject({ ok: false, reason: /passkey que no está en el padrón/ });
  });
});

// HU-3987: each key appears once in the roster, and a key with a revoked entry is not live.
describe("each key appears once in the roster", () => {
  const code = issueRecoveryCode();
  const proof = sha(code.code);
  const one = { signers: [{ publicKey: a.pub }], recovery: { fingerprint: code.fingerprint } };
  const replaced = { signers: [{ publicKey: a.pub, revoked: { recoveryProof: proof } }, { publicKey: b.pub, admission: { recoveryProof: proof } }], recovery: { fingerprint: issueRecoveryCode().fingerprint } };
  const repeats = /repite la clave .*: cada clave entra una vez/;

  it("refuses a revoked key with an unrevoked copy appended, and a typed copy of a known key", () => {
    expect(verifyRosterChange({ before: replaced, after: { ...replaced, signers: [...replaced.signers, { publicKey: a.pub }] } })).toMatchObject({ ok: false, reason: repeats });
    expect(verifyRosterChange({ before: one, after: { ...one, signers: [...one.signers, { publicKey: a.pub, type: "webauthn" }] } })).toMatchObject({ ok: false, reason: repeats });
  });

  it("refuses a duplicate in a first roster, and reports a previous roster that holds one", () => {
    const doubled = { ...one, signers: [...one.signers, ...one.signers] };
    expect(verifyRosterChange({ before: null, after: doubled })).toMatchObject({ ok: false, reason: /^el padrón repite la clave/ });
    expect(verifyRosterChange({ before: doubled, after: one })).toMatchObject({ ok: false, reason: /^el padrón anterior repite la clave .*: cada clave entra una vez/ });
  });

  it("the readers report a key with one revoked entry as not live", () => {
    const pk = { type: "webauthn", credentialId: "cred-1", publicKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "der" }).toString("base64"), alg: -7 };
    admit({ publicKey: a.pub }); // creates the roster's directory
    writeFileSync(join(dir, SIGNERS_FILE), JSON.stringify({ signers: [...replaced.signers, { publicKey: a.pub }, { ...pk, revoked: { recoveryProof: proof } }, pk] }));
    expect(readSigners({ projectDir: dir })).toEqual([b.pub]);
    expect(readPasskeyCredentials({ projectDir: dir })).toEqual([]);
  });
});
