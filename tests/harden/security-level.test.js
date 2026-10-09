// KJC-TSK-0967 (HUM-D, ADR 0018): the security level is a versioned, signed
// record. Down is a catalog act signed by the phone; up is free; a record that
// cannot be trusted reads as max and says why.
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalPayload, enrollPhone } from "../../src/harden/phone-sign.js";
import { DEFAULT_LEVEL, lowerSecurityLevel, raiseSecurityLevel, readSecurityLevel, SECURITY_LEVEL_FILE, signedFilesOf } from "../../src/harden/security-level.js";

const keyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"), privateKey };
};
const mine = keyPair();
const HUMAN = { env: {}, tty: true, deps: { confirm: (n) => n, ancestry: { pid: 100, readProc: () => ({ ppid: 1, cmd: "bash" }) } } };
/** A phone that signs what kj asks, the way the relay returns it; the request seen stays in `asked.last`. */
const asked = { last: null };
const phoneOf = (key, { ok = true } = {}) => ({
  enrolled: () => true,
  request: async (req) => {
    asked.last = req;
    if (!ok) return { ok: false, reason: "caducado" };
    const challenge = { cid: "c1", nonce: "n1", project: req.project, v: 2, kjVersion: req.kjVersion, issuedMs: 1, expiresMs: 2 };
    const signature = cryptoSign(null, Buffer.from(canonicalPayload({ ...challenge, files: req.files }), "utf8"), key.privateKey).toString("base64");
    return { ok: true, signer: key.pub, signature, challenge };
  },
});
const never = { enrolled: () => false, request: async () => { throw new Error("must not be called"); } };

let repo, home;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-seclevel-"));
  home = mkdtempSync(join(tmpdir(), "kj-seclevel-home-"));
  mkdirSync(join(repo, ".karajan"));
  enrollPhone(mine.pub, { home });
});
afterEach(() => { for (const dir of [repo, home]) rmSync(dir, { recursive: true, force: true }); });

const read = () => readSecurityLevel({ projectDir: repo, home });
const lower = (over = {}) => lowerSecurityLevel({ ...HUMAN, projectDir: repo, home, kjVersion: "9.9.9", logger: { info() {} }, ...over, deps: { ...HUMAN.deps, phone: phoneOf(mine), ...over.deps } });

it("no record: the default level, named as such", () => {
  expect(read()).toEqual({ level: DEFAULT_LEVEL, source: "default" });
});

it("a record that cannot be trusted reads as max and says why", () => {
  const cases = [
    ["{not json", /no es JSON/],
    [JSON.stringify({ level: "paranoid" }), /nivel que no existe/],
    [JSON.stringify({ level: "normal", since: "2026-10-09" }), /nivel normal no lleva firma; vale como máxima/],
    [JSON.stringify({ level: "normal", since: "2026-10-09", signature: { signer: keyPair().pub, signature: "AAAA" } }), /clave que no está en el padrón/],
  ];
  for (const [text, reason] of cases) {
    writeFileSync(join(repo, SECURITY_LEVEL_FILE), text);
    expect(read()).toMatchObject({ level: "max", source: "invalid", reason });
  }
});

describe("lowerSecurityLevel (the catalog act security-level-down), from max", () => {
  beforeEach(() => writeFileSync(join(repo, SECURITY_LEVEL_FILE), JSON.stringify({ level: "max", since: "2026-10-09" })));

  it("signs the record's exact bytes with the phone, says what and why, and the level reads as normal", async () => {
    expect((await lower()).changed).toBe(true);
    const record = JSON.parse(readFileSync(join(repo, SECURITY_LEVEL_FILE), "utf8"));
    expect(asked.last.files).toEqual(signedFilesOf(record));
    expect(asked.last.origin).toMatch(/^kj security normal/);
    expect(asked.last.changes[0].diff).toMatch(/Qué se va a hacer.*\n.*\n.*Por qué se pide.*\n.*Si lo hiciera otro/);
    expect(read()).toMatchObject({ level: "normal", source: "file", signer: mine.pub });
    expect((await lower({ deps: { phone: { ...never, enrolled: () => true } } })).changed).toBe(false); // already normal: nothing to sign
    // The bytes signed are the bytes kept: touch `since` and the record is worth nothing.
    writeFileSync(join(repo, SECURITY_LEVEL_FILE), JSON.stringify({ ...record, since: "1999-01-01" }));
    expect(read()).toMatchObject({ level: "max", reason: /no corresponde/ });
  });

  it("is a human act: an agent session, a wrong nonce or a refused signature change nothing", async () => {
    await expect(lower({ env: { CLAUDECODE: "1" } })).rejects.toThrow(/kj security normal es un acto humano/);
    await expect(lower({ deps: { confirm: () => "nope" } })).rejects.toThrow(/confirmación humana fallida/);
    await expect(lower({ deps: { phone: phoneOf(mine, { ok: false }) } })).rejects.toThrow(/firma del móvil rechazada \(caducado\); el nivel no cambia/);
    expect(read()).toMatchObject({ level: "max", source: "file" });
  });

  it("without an enrolled phone it refuses, says how to enroll, and never asks for the typed code instead", async () => {
    let confirmed = false;
    await expect(lower({ deps: { confirm: () => { confirmed = true; return "x"; }, phone: never } })).rejects.toThrow(/no hay ninguno enrolado.*kj identity enroll-phone/);
    expect(confirmed).toBe(false);
  });

  it("raiseSecurityLevel: up is free and idempotent; it also replaces a record that cannot be trusted", async () => {
    const raise = () => raiseSecurityLevel({ projectDir: repo, home });
    await lower();
    expect(raise()).toMatchObject({ changed: true, level: { level: "max", source: "file" } });
    expect(raise().changed).toBe(false);
    writeFileSync(join(repo, SECURITY_LEVEL_FILE), "{broken");
    expect(raise()).toMatchObject({ changed: true, level: { level: "max", source: "file" } });
  });
});
