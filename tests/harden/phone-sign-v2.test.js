// KJC-TSK-0901 + 0902 (ADR 0012): la firma del movil v2 cubre TODO lo que la
// pantalla ensena (proyecto, version de kj, ficheros) y su propia vigencia
// (emision y caducidad) dentro de los bytes firmados. v1 sigue valiendo: kj solo
// pide v2 cuando el relay.json de la landing lo anuncia, que se despliega junto
// con la pagina y las reglas, asi que un kj antiguo nunca se queda sin sello.
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalPayload, enrollPhone, requestPhoneSignature } from "../../src/harden/phone-sign.js";

const FILES = [{ file: ".karajan/hooks/pre-commit", sha256: "ab".repeat(32) }];
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const rawPub = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const signWith = (payload) => cryptoSign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");

let home, t;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "kj-phone2-")); t = 1_700_000_000_000; enrollPhone(rawPub, { home }); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Movil falso v2: lee el doc publicado como la pagina y firma lo que ensenaria. */
const phone = ({ payloadVersion = 2, signAt = null } = {}) => {
  const doc = {};
  return async (url, opts = {}) => {
    if (String(url).endsWith("/sign/relay.json")) {
      return { ok: true, json: async () => ({ projectId: "p", apiKey: "k", collection: "c", ...(payloadVersion ? { payloadVersion } : {}) }) };
    }
    if (opts.method === "POST") {
      doc.cid = new URL(url).searchParams.get("documentId");
      doc.fields = JSON.parse(opts.body).fields;
      return { ok: true, json: async () => ({}) };
    }
    const f = doc.fields;
    const v2 = f.v?.integerValue === "2";
    const payload = v2
      ? canonicalPayload({ v: 2, cid: doc.cid, nonce: f.nonce.stringValue, project: f.project.stringValue, files: FILES,
        kjVersion: f.kj_version.stringValue, issuedMs: Date.parse(f.createdAt.timestampValue), expiresMs: Date.parse(f.expires_at.timestampValue) })
      : canonicalPayload({ cid: doc.cid, nonce: f.nonce.stringValue, project: f.project.stringValue, files: FILES });
    if (signAt !== null) t = signAt;
    return { ok: true, json: async () => ({ fields: { state: { stringValue: "signed" }, signature: { stringValue: signWith(payload) }, publicKey: { stringValue: rawPub } } }) };
  };
};
const request = (fetchFn) => requestPhoneSignature({
  project: "karajan-code", files: FILES, kjVersion: "4.36.0", logger: { info: () => {} },
  deps: { fetch: fetchFn, home, now: () => t, sleep: async (ms) => { t += ms; }, qr: () => {} },
});

// KJC-TSK-0992 (HUM-G): what the page shows beside the sha256 travels in the
// request, outside the signed payload: the signature is unchanged.
describe("the request says what changes", () => {
  it("publishes changes, branch and origin as Firestore values, and the v2 signature still verifies", async () => {
    let posted = null;
    const fake = phone();
    const spy = async (url, opts = {}) => { if (opts.method === "POST") posted = JSON.parse(opts.body).fields; return fake(url, opts); };
    const changes = [{ file: FILES[0].file, status: "modified", added: 2, removed: 1, summary: "KJC-BUG-0302: left to the seal", diff: "diff --git a b\n+# x\n", truncated: false }];
    const res = await requestPhoneSignature({
      project: "karajan-code", files: FILES, kjVersion: "4.46.0", changes, branch: "feat/x", origin: "kj harden 4.46.0", logger: { info: () => {} },
      deps: { fetch: spy, home, now: () => t, sleep: async (ms) => { t += ms; }, qr: () => {} },
    });
    expect(res.ok).toBe(true);
    expect(posted.branch).toEqual({ stringValue: "feat/x" });
    expect(posted.origin).toEqual({ stringValue: "kj harden 4.46.0" });
    const c = posted.changes.arrayValue.values[0].mapValue.fields;
    expect(c.status).toEqual({ stringValue: "modified" });
    expect(c.added).toEqual({ integerValue: "2" });
    expect(c.summary.stringValue).toBe("KJC-BUG-0302: left to the seal");
    expect(c.truncated).toEqual({ booleanValue: false });
  });
});

describe("phone signature v2", () => {
  it("covers version, issue and expiry: a v2 payload differs if any of them changes", () => {
    const base = { v: 2, cid: "c", nonce: "n", project: "p", files: FILES, kjVersion: "4.36.0", issuedMs: 1, expiresMs: 2 };
    const p = canonicalPayload(base);
    expect(p).toMatch(/^kj-supervisor-sign:v2:c:n:p:4\.36\.0:1:2:[0-9a-f]{64}$/);
    for (const k of ["kjVersion", "issuedMs", "expiresMs"]) expect(canonicalPayload({ ...base, [k]: `${base[k]}x` })).not.toBe(p);
  });

  it("with the relay announcing v2, kj publishes version and expiry and verifies the v2 signature", async () => {
    const res = await request(phone());
    expect(res).toMatchObject({ ok: true, challenge: { v: 2, kjVersion: "4.36.0", issuedMs: 1_700_000_000_000, expiresMs: 1_700_000_060_000 } });
  });

  it("a signature that arrives after its signed expiry is refused, even if it verifies", async () => {
    const res = await request(phone({ signAt: 1_700_000_061_000 }));
    expect(res).toMatchObject({ ok: false });
    expect(res.reason).toMatch(/vigencia/);
  });

  it("without the relay announcing v2, kj keeps v1: an old signer page still works", async () => {
    const res = await request(phone({ payloadVersion: null }));
    expect(res).toMatchObject({ ok: true });
    expect(res.challenge.v ?? 1).toBe(1);
  });
});

// KJC-TSK-0902: lo que la pagina ensena es lo que firma. Contrato con el HTML real.
describe("the signer page signs what it shows", () => {
  const page = readFileSync(join(import.meta.dirname, "..", "..", "apps", "landing", "public", "sign", "index.html"), "utf8");
  it("shows project, kj version, expiry and files", () => {
    for (const id of ["project", "version", "expires", "files"]) expect(page, id).toMatch(new RegExp(`id="${id}"`));
  });
  it("its v2 payload includes every one of them", () => {
    const line = page.split("\n").find((l) => l.includes("kj-supervisor-sign:v2"));
    expect(line).toBeTruthy();
    for (const v of ["project", "kjVersion", "issuedMs", "expiresMs", "filesHash"]) expect(line, v).toContain(`\${${v}}`);
  });
});
