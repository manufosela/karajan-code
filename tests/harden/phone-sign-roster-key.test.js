// HU-4887 (KJC-BUG-0665): with a roster in the repo, a seal is signed with what that roster holds.
// The machine's legacy phone key (~/.karajan) signed a seal in a repo whose roster held only a
// passkey; CI verifies against the roster alone, so the seal backed nothing. A signature the repo's
// roster would reject is refused when it is made, naming the roster; with no roster the legacy key
// signs as before.
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalPayload, enrollPhone, requestPhoneSignature } from "../../src/harden/phone-sign.js";

const FILES = [{ file: ".karajan/hooks/pre-commit", sha256: "ab".repeat(32) }];
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const rawPub = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const signWith = (payload) => cryptoSign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");

let home, projectDir, t;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-roster-home-"));
  projectDir = mkdtempSync(join(tmpdir(), "kj-roster-repo-"));
  t = 1_700_000_000_000;
  enrollPhone(rawPub, { home });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

const writeRoster = (signers) => {
  mkdirSync(join(projectDir, ".karajan"), { recursive: true });
  writeFileSync(join(projectDir, ".karajan", "supervisor-signers.json"), `${JSON.stringify({ signers }, null, 2)}\n`);
};
const PASSKEY = { type: "webauthn", credentialId: "EzG9AWj_ns5kuJF8MMpTmQ", publicKey: "pQECAyYgASFYIA", alg: -7, label: "passkey-test" };

/** A phone that signs with the machine's legacy key, as the page does when the person picks it. */
const phone = () => {
  const doc = {};
  return async (url, opts = {}) => {
    if (String(url).endsWith("/sign/relay.json")) return { ok: true, json: async () => ({ projectId: "p", apiKey: "k", collection: "c", payloadVersion: 2 }) };
    if (opts.method === "POST") {
      doc.cid = new URL(url).searchParams.get("documentId");
      doc.fields = JSON.parse(opts.body).fields;
      return { ok: true, json: async () => ({}) };
    }
    const f = doc.fields;
    const payload = canonicalPayload({ v: 2, cid: doc.cid, nonce: f.nonce.stringValue, project: f.project.stringValue, files: FILES,
      kjVersion: f.kj_version.stringValue, issuedMs: Date.parse(f.createdAt.timestampValue), expiresMs: Date.parse(f.expires_at.timestampValue) });
    return { ok: true, json: async () => ({ fields: { state: { stringValue: "signed" }, signature: { stringValue: signWith(payload) }, publicKey: { stringValue: rawPub } } }) };
  };
};
const request = () => requestPhoneSignature({
  project: "owner/repo", files: FILES, kjVersion: "5.37.0", logger: { info: () => {} },
  deps: { fetch: phone(), home, projectDir, now: () => t, sleep: async (ms) => { t += ms; }, qr: () => {} },
});

describe("a seal is signed with what the repo's roster holds (HU-4887)", () => {
  it("refuses the machine's phone key when the roster holds only a passkey, and says to sign with the passkey", async () => {
    writeRoster([PASSKEY]);
    const res = await request();
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/padrón del repo/);
    expect(res.reason).toMatch(/passkey/);
  });

  it("accepts the phone key when the repo's roster lists it", async () => {
    writeRoster([PASSKEY, { publicKey: rawPub, label: "phone", enrolledAt: "2026-11-01T00:00:00.000Z" }]);
    const res = await request();
    expect(res.ok).toBe(true);
    expect(res.signer).toBe(rawPub);
  });

  it("accepts the machine's phone key when the repo has no roster, as before", async () => {
    const res = await request();
    expect(res.ok).toBe(true);
    expect(res.signer).toBe(rawPub);
  });
});
