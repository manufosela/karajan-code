// HU-3986 (ADR 0053): `kj identity enroll-phone` without a key asks the relay for a new
// passkey; kj accepts the answer only when its key loads and matches its algorithm.
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { requestPasskeyRegistration } from "../../src/harden/phone-sign.js";

const spki = (type, opts = {}) => generateKeyPairSync(type, opts).publicKey.export({ type: "spki", format: "der" }).toString("base64");
const ES256 = spki("ec", { namedCurve: "P-256" });
const ED25519 = spki("ed25519");

/** A fake relay: keeps what kj posts and answers the poll with `answer` (or pending forever). */
const relay = (answer) => {
  const seen = { posted: null };
  const fetchFn = async (url, opts = {}) => {
    if (String(url).endsWith("/sign/relay.json")) return { ok: true, json: async () => ({ projectId: "p", apiKey: "k", collection: "c", payloadVersion: 2 }) };
    if (opts.method === "POST") { seen.posted = JSON.parse(opts.body).fields; return { ok: true, json: async () => ({}) }; }
    const fields = answer ? { state: { stringValue: "registered" }, ...answer } : { state: { stringValue: "pending" } };
    return { ok: true, json: async () => ({ fields }) };
  };
  return { seen, fetchFn };
};
const answerOf = ({ credentialId = "cred_Id-1", publicKey = ES256, alg = -7 }) => ({
  credentialId: { stringValue: credentialId }, publicKey: { stringValue: publicKey }, alg: { integerValue: String(alg) },
});
const register = async (answer) => {
  let t = 1_700_000_000_000;
  const fake = relay(answer);
  const res = await requestPasskeyRegistration({
    project: "karajan-code", label: "mine", kjVersion: "5.16.0", logger: { info: () => {} },
    deps: { fetch: fake.fetchFn, now: () => t, sleep: async (ms) => { t += ms; }, qr: () => {}, spinner: { tick() {}, stop() {} } },
  });
  return { res, posted: fake.seen.posted };
};

describe("requestPasskeyRegistration", () => {
  it("accepts a valid ES256 answer and a valid Ed25519 one", async () => {
    expect((await register(answerOf({}))).res).toEqual({ ok: true, credential: { credentialId: "cred_Id-1", publicKey: ES256, alg: -7 } });
    expect((await register(answerOf({ publicKey: ED25519, alg: -8 }))).res).toEqual({ ok: true, credential: { credentialId: "cred_Id-1", publicKey: ED25519, alg: -8 } });
  });

  it("refuses a wrong alg, a key that does not match its alg and an empty credential id", async () => {
    for (const answer of [answerOf({ alg: -257 }), answerOf({ publicKey: ED25519, alg: -7 }), answerOf({ alg: -8 }), answerOf({ publicKey: "bm8=" }), answerOf({ credentialId: "" }), answerOf({ credentialId: "a+b/" })]) {
      const { res } = await register(answer);
      expect(res.ok).toBe(false);
      expect(res.reason).toEqual(expect.any(String));
    }
  });

  it("returns caducado when nobody answers before the request expires", async () => {
    expect((await register(null)).res).toEqual({ ok: false, reason: "caducado" });
  });

  it("posts exactly the fields the relay rules admit for a register request, for 10 minutes", async () => {
    const { posted } = await register(answerOf({}));
    expect(Object.keys(posted).toSorted()).toEqual(["createdAt", "expires_at", "files", "kind", "kj_version", "nonce", "passkey", "project", "state", "user_label", "v"]);
    expect(posted).toMatchObject({
      kind: { stringValue: "register" }, passkey: { booleanValue: true }, user_label: { stringValue: "mine · karajan-code" }, state: { stringValue: "pending" },
      v: { integerValue: "2" }, files: { arrayValue: { values: [] } }, project: { stringValue: "karajan-code" }, kj_version: { stringValue: "5.16.0" },
    });
    expect(Date.parse(posted.expires_at.timestampValue) - Date.parse(posted.createdAt.timestampValue)).toBe(600000);
  });
});
