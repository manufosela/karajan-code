// HU-3986 (ADR 0053): `kj identity enroll-phone` without a key registers a passkey through
// the relay and admits it into the roster with the rules every phone enters by.
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { identityCommand } from "../../src/commands/identity.js";
import { admissionFiles, verifyRosterChange } from "../../src/harden/roster.js";

const ES256 = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
const human = { env: {}, ttyHuman: true, ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) }, confirm: (nonce) => nonce };

let dir, lines, calls;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-enroll-passkey-")); lines = []; calls = 0; });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A fake relay whose phone answers the register request with `credential`. */
const relayFetch = ({ credentialId = "cred_Id-1", publicKey = ES256, alg = -7 } = {}) => async (url, opts = {}) => {
  calls += 1;
  if (String(url).endsWith("/sign/relay.json")) return { ok: true, json: async () => ({ projectId: "p", apiKey: "k", collection: "c" }) };
  if (opts.method === "POST") return { ok: true, json: async () => ({}) };
  const fields = { state: { stringValue: "registered" }, credentialId: { stringValue: credentialId }, publicKey: { stringValue: publicKey }, alg: { integerValue: String(alg) } };
  return { ok: true, json: async () => ({ fields }) };
};
const run = (extra = {}, credential) => identityCommand({
  action: "enroll-phone", config: { projectDir: dir }, flags: { label: "mine" },
  deps: { log: (l) => lines.push(l), home: dir, ...human, fetch: relayFetch(credential), qr: () => {}, spinner: { tick() {}, stop() {} }, ...extra },
});
const rosterPath = () => path.join(dir, ".karajan", "supervisor-signers.json");
const phoneFile = () => path.join(dir, ".karajan", "supervisor-phone.json");

describe("kj identity enroll-phone without a key", () => {
  it("bootstraps an empty roster with one webauthn entry that CI accepts, and leaves the home phone file alone", async () => {
    expect(await run()).toBe(0);
    const roster = JSON.parse(fs.readFileSync(rosterPath(), "utf8"));
    expect(roster.signers).toEqual([expect.objectContaining({ type: "webauthn", credentialId: "cred_Id-1", publicKey: ES256, alg: -7, label: "mine" })]);
    expect(verifyRosterChange({ before: { signers: [] }, after: roster })).toEqual({ ok: true, bootstrap: true });
    expect(fs.existsSync(phoneFile())).toBe(false);
    // HU-4056 (KJC-BUG-0570): since 5.20.0 the seal and the human acts ask for the passkey.
    expect(lines.join("\n")).toMatch(/passkey enrolada.*cuando se mergee.*el sello y los actos humanos la pedirán/is);
    expect(lines.join("\n")).not.toMatch(/próxima versión/i);
  });

  it("asks a present Ed25519 signer to sign the admission of the passkey's public key", async () => {
    let asked;
    const phone = { enrolled: () => true, request: async (req) => { asked = req; return { ok: false, reason: "caducado" }; } };
    expect(await run({ phone })).toBe(1);
    expect(asked.files).toEqual(admissionFiles(ES256));
    expect(fs.existsSync(rosterPath())).toBe(false);
  });

  it("refuses an agent session before any relay call", async () => {
    expect(await run({ env: { CLAUDECODE: "1" } })).toBe(1);
    expect(lines.join("\n")).toMatch(/acto humano/);
    expect(calls).toBe(0);
  });

  it("writes nothing when the relay answers an invalid credential", async () => {
    expect(await run({}, { alg: -8 })).toBe(1);
    expect(fs.existsSync(rosterPath())).toBe(false);
    expect(fs.existsSync(phoneFile())).toBe(false);
  });
});
