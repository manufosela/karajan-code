// KJC-BUG-0303 (#2035): the relay's Firestore rules must admit every field kj
// publishes in a signing request. kj 4.46 added changes/branch/origin (and main
// adds why) and the rules' hasOnly did not know them: every seal got a 403.
import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { requestPhoneSignature } from "../../src/harden/phone-sign.js";

const rules = readFileSync(new URL("../../apps/landing/firestore.rules", import.meta.url), "utf8");
const createRule = rules.match(/allow create: if request\.resource\.data\.keys\(\)\.hasOnly\(\[([^\]]*)\]\)/);
const admitted = new Set([...createRule[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

it("the create rule admits every field of a full v2 request, informative ones included", async () => {
  let body = null;
  const fetchFn = async (url, opts = {}) => {
    if (String(url).endsWith("/sign/relay.json")) return { ok: true, json: async () => ({ projectId: "p", apiKey: "k", collection: "c", payloadVersion: 2 }) };
    if (opts.method === "POST") { body = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; }
    throw new Error("the request expires before any poll");
  };
  let t = 1_700_000_000_000;
  const res = await requestPhoneSignature({
    project: "p", files: [{ file: ".karajan/hooks/pre-commit", sha256: "ab".repeat(32) }], kjVersion: "9.9.9", branch: "main", origin: "harden --commit (kj 9.9.9)",
    changes: [{ file: ".karajan/hooks/pre-commit", status: "new", added: 1, removed: 0, summary: "s", diff: "+x", truncated: false }],
    why: "Qué se va a hacer: …", logger: { info() {} },
    // Each clock read jumps past kj's wait (150 s, KJC-BUG-0432), so the request expires before any poll.
    deps: { fetch: fetchFn, now: () => (t += 160_000), sleep: async () => {}, qr: () => {}, spinner: { tick() {}, stop() {} } },
  });
  expect(res).toMatchObject({ ok: false, reason: "caducado" });
  const sent = Object.keys(body.fields);
  expect(sent).toEqual(expect.arrayContaining(["nonce", "project", "files", "kj_version", "createdAt", "state", "v", "expires_at", "changes", "branch", "origin", "why"]));
  for (const key of sent) expect(admitted.has(key), `apps/landing/firestore.rules: the create rule's hasOnly must admit "${key}"`).toBe(true);
});

// KJC-TSK-1535 (owner's decision, 11-nov): a phone enrollment link travels to another signer, so a
// v2 request may live up to 10 minutes, and the signature is admitted until the request's own expiry.
it("a v2 request may expire up to 10 minutes after creation, and is signed until its own expiry", () => {
  expect(rules).toContain("request.resource.data.expires_at <= request.resource.data.createdAt + duration.value(10, 'm')");
  const update = rules.slice(rules.indexOf("allow update:"));
  expect(update).toMatch(/request\.time < \('expires_at' in resource\.data \? resource\.data\.expires_at : resource\.data\.createdAt \+ duration\.value\(3, 'm'\)\)/);
});

// HU-3927 (ADR 0053): a passkey signature PATCHes the assertion and the credential id, as strings.
it("the update rule admits a passkey assertion, as strings", () => {
  const update = rules.slice(rules.indexOf("allow update:"));
  expect(update).toContain("affectedKeys().hasOnly(['state', 'signature', 'publicKey', 'signedAt', 'authenticatorData', 'clientDataJSON', 'credentialId'])");
  for (const key of ["authenticatorData", "clientDataJSON", "credentialId"]) {
    expect(update).toContain(`(!('${key}' in request.resource.data) || request.resource.data.${key} is string)`);
  }
});

// HU-3927: kj marks a request that accepts a passkey with passkey: true, a bool.
it("the create rule admits a passkey flag, as a bool", () => {
  expect(admitted.has("passkey")).toBe(true);
  expect(rules).toContain("(!('passkey' in request.resource.data) || request.resource.data.passkey is bool)");
});

// HU-4193: kj lists the roster's passkey ids in allow; the rules cap it as a list of at most 20.
it("the create rule admits allow only as a list of at most 20", () => {
  expect(admitted.has("allow")).toBe(true);
  expect(rules).toContain("(!('allow' in request.resource.data) || (request.resource.data.allow is list && request.resource.data.allow.size() <= 20))");
});

// HU-3976 (ADR 0053): a register request carries kind and user_label, as strings.
it("the create rule admits a register request: kind and user_label, as strings", () => {
  for (const key of ["kind", "user_label"]) {
    expect(admitted.has(key), key).toBe(true);
    expect(rules).toContain(`(!('${key}' in request.resource.data) || request.resource.data.${key} is string)`);
  }
});

// HU-3976: a register request is answered pending -> registered with exactly the new passkey; signing stays as it was.
it("a second update rule admits pending -> registered with exactly the passkey fields, until the request's expiry", () => {
  const first = rules.indexOf("allow update:");
  const last = rules.lastIndexOf("allow update:");
  expect(first).toBeLessThan(last);
  const register = rules.slice(last);
  expect(register).toContain("resource.data.get('kind', '') == 'register'");
  expect(register).toContain("request.resource.data.state == 'registered'");
  const keys = "['state', 'credentialId', 'publicKey', 'alg', 'signedAt']";
  expect(register).toContain(`affectedKeys().hasOnly(${keys})`);
  expect(register).toContain(`affectedKeys().hasAll(${keys})`);
  for (const key of ["credentialId", "publicKey"]) expect(register).toContain(`request.resource.data.${key} is string`);
  expect(register).toContain("request.resource.data.alg is int");
  expect(register).toContain("request.resource.data.signedAt is timestamp");
  expect(register).toMatch(/request\.time < \('expires_at' in resource\.data \? resource\.data\.expires_at : resource\.data\.createdAt \+ duration\.value\(3, 'm'\)\)/);
  const signing = rules.slice(first, last);
  expect(signing).toContain("request.resource.data.state == 'signed'");
  expect(signing).not.toContain("state == 'registered'");
});
