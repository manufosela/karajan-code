// KJC-TSK-0996 (HUM-D, ADR 0018): the level applied to every catalog act, in one place.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { explainAct, signAct } from "../../src/harden/act-sign.js";
import { addSigner, readEnrolledKeys } from "../../src/harden/phone-sign.js";
import { SECURITY_LEVEL_FILE } from "../../src/harden/security-level.js";
import { setNormalLevel } from "../_fixtures/set-normal-level.js";

const FILES = [{ file: ".karajan/rules.yml", sha256: "ab".repeat(32) }];
const CHALLENGE = { cid: "c", nonce: "n", project: "p", v: 2, kjVersion: "9.9.9", issuedMs: 1, expiresMs: 2 };
let repo, home, warned, asked;
const phone = ({ enrolled = true, ok = true, challenge = CHALLENGE } = {}) => ({
  enrolled: () => enrolled,
  request: async (req) => { asked = req; return ok ? { ok: true, signer: "PUB", signature: "SIG", challenge } : { ok: false, reason: "caducado" }; },
});
const sign = (id, opts = {}) => signAct(id, { projectDir: repo, home, kjVersion: "9.9.9", files: FILES, logger: { warn: (l) => warned.push(l) }, ...opts });
const atMax = () => writeFileSync(join(repo, SECURITY_LEVEL_FILE), JSON.stringify({ level: "max", since: "2026-10-09" }));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-actsign-"));
  home = mkdtempSync(join(tmpdir(), "kj-actsign-home-"));
  mkdirSync(join(repo, ".karajan"));
  warned = []; asked = null;
});
afterEach(() => { for (const dir of [repo, home]) rmSync(dir, { recursive: true, force: true }); });

describe("signAct", () => {
  it("with a phone: signs the exact files, says what, why and what if another did it, and returns the block", async () => {
    atMax();
    const res = await sign("rules-approve", { deps: { phone: phone() } });
    expect(asked).toMatchObject({ files: FILES, kjVersion: "9.9.9", origin: "kj rules approve (kj 9.9.9)", why: explainAct("rules-approve") });
    expect(asked.why).toMatch(/^Qué se va a hacer: .*\nPor qué se pide tu firma: .*\nSi lo hiciera otro: /);
    expect(res).toEqual({ level: { level: "max", source: "file", since: "2026-10-09" }, signature: { ...CHALLENGE, signer: "PUB", signature: "SIG" } });
    expect(warned).toEqual([]);
  });

  it("a refused signature, or an unknown act, is an error; a relay with no challenge gives no block", async () => {
    await expect(sign("supervisor-seal", { deps: { phone: phone({ ok: false }) } })).rejects.toThrow(/harden --commit: firma del móvil rechazada \(caducado\)/);
    await expect(sign("delete-all", { deps: { phone: phone() } })).rejects.toThrow(/not in the catalog/);
    expect(() => explainAct("handoff-run")).toThrow(/no explanation for the phone/);
    expect((await sign("phone-enroll", { deps: { phone: phone({ challenge: null }) } })).signature).toBeNull();
  });

  it("at max with no phone: refused with the way to enroll, except the first enrollment (bootstrap)", async () => {
    atMax();
    await expect(sign("supervisor-seal", { deps: { phone: phone({ enrolled: false }) } })).rejects.toThrow(/con seguridad máxima este acto se firma con el móvil y no hay ninguno enrolado.*kj identity enroll-phone/);
    await expect(sign("rules-approve", { deps: { phone: phone({ enrolled: false }) } })).rejects.not.toThrow(/kj security normal/);
    const res = await sign("phone-enroll", { bootstrap: true, deps: { phone: phone({ enrolled: false }) } });
    expect(res.signature).toBeNull();
    expect(warned[0]).toMatch(/kj identity enroll-phone: sin móvil enrolado solo valen las cuatro capas y la garantía es menor/);
  });

  // HU-3887 (KJC-BUG-0551): a phone of the repo roster signs even when this machine has none.
  it("at max with a roster key and no phone on this machine: the signature is requested and returned", async () => {
    atMax();
    addSigner(generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"), { projectDir: repo });
    const seen = [];
    const enrolled = (where) => { seen.push(where); return readEnrolledKeys(where).size > 0; };
    const res = await sign("phone-enroll", { deps: { phone: { ...phone(), enrolled } } });
    expect(seen).toEqual([{ projectDir: repo, home }]);
    expect(asked).toMatchObject({ files: FILES, deps: { projectDir: repo, home } });
    expect(res.signature).toEqual({ ...CHALLENGE, signer: "PUB", signature: "SIG" });
  });

  // HU-3912: only the enrollment asks the relay for a 10-minute link.
  it("phone-enroll asks for ttlMs 600000; any other act leaves the default", async () => {
    await sign("phone-enroll", { deps: { phone: phone() } });
    expect(asked.ttlMs).toBe(600000);
    await sign("rules-approve", { deps: { phone: phone() } });
    expect(asked).not.toHaveProperty("ttlMs");
  });

  it("by default, a roster key is a phone that can sign: no refusal at max", async () => {
    atMax();
    addSigner(generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"), { projectDir: repo });
    const { request } = phone();
    expect((await sign("rules-approve", { deps: { phone: { request } } })).signature).not.toBeNull();
  });

  it("at normal: the act says the guarantee is lesser; with a phone it still signs, without one it goes on", async () => {
    setNormalLevel(repo);
    expect((await sign("rules-approve", { deps: { phone: phone() } })).signature).not.toBeNull();
    expect(warned[0]).toMatch(/seguridad normal, la garantía es menor.*kj security max/);
    expect((await sign("rules-approve", { deps: { phone: phone({ enrolled: false }) } })).signature).toBeNull();
    expect(warned[1]).toMatch(/sin móvil enrolado solo valen las cuatro capas/);
  });

  it("a record that cannot be trusted is said, and the act runs at max", async () => {
    writeFileSync(join(repo, SECURITY_LEVEL_FILE), JSON.stringify({ level: "normal", since: "x" }));
    await expect(sign("rules-approve", { deps: { phone: phone({ enrolled: false }) } })).rejects.toThrow(/seguridad máxima/);
    expect(warned[0]).toMatch(/security-level\.json: el nivel normal no lleva firma; vale como máxima/);
  });
});
