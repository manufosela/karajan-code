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
