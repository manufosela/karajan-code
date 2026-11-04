// KJC-TSK-1402: a merge that skips its checks on purpose carries the maintainer's exception,
// signed on the phone over the repo, the PR, its head commit and the reason, posted as a PR comment.
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { exceptionFiles, findValidException, renderException } from "../../src/guards/main-guard-exception.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const signer = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
const keys = new Set([signer]);
const exception = { repo: "acme/app", pr: 7, head: "abc1234", why: "transition merge, ADR 0037" };

/** What the phone returns for these files: the challenge it signed, the key and the signature. */
function signed(files, key = privateKey) {
  const challenge = { cid: "c1", nonce: "n1", project: "app", v: 2, kjVersion: "5.5.0", issuedMs: 1, expiresMs: 2 };
  return { ...challenge, signer, signature: sign(null, Buffer.from(canonicalPayload({ ...challenge, files }), "utf8"), key).toString("base64") };
}
const comment = (over = {}) => renderException({ ...exception, signature: signed(exceptionFiles(exception)), ...over });

describe("main-guard exception", () => {
  it("a comment signed over this PR and head is a valid exception, and names its reason", () => {
    const found = findValidException({ bodies: ["looks good", comment()], ...exception, keys });
    expect(found).toMatchObject({ ok: true, why: exception.why });
  });

  it("is not valid for another head, another PR, a changed reason or a key outside the roster", () => {
    const body = comment();
    expect(findValidException({ bodies: [body], ...exception, head: "fff0000", keys }).ok).toBe(false);
    expect(findValidException({ bodies: [body], ...exception, pr: 8, keys }).ok).toBe(false);
    expect(findValidException({ bodies: [body.replaceAll(exception.why, "anything")], ...exception, keys }).ok).toBe(false);
    expect(findValidException({ bodies: [body], ...exception, keys: new Set() }).ok).toBe(false);
  });

  it("a forged signature or a comment with no exception block is no exception, and says why", () => {
    const { privateKey: other } = generateKeyPairSync("ed25519");
    const forged = renderException({ ...exception, signature: signed(exceptionFiles(exception), other) });
    expect(findValidException({ bodies: [forged], ...exception, keys })).toMatchObject({ ok: false, reason: expect.stringMatching(/firma/) });
    expect(findValidException({ bodies: ["```kj-exception\nnot json\n```", "plain"], ...exception, keys })).toMatchObject({ ok: false, reason: expect.stringMatching(/no signed exception/) });
  });
});
