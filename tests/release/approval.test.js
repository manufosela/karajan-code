// HU-4188 (ADR 0057, step 5): the approval of a release is signed over its repo, version, issue and
// candidate, posted as a comment of the release issue and verified against the roster.
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { approvalFiles, findValidApproval, renderApproval } from "../../src/release/approval.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const signer = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
const keys = new Set([signer]);
const approval = { repo: "acme/app", version: "1.2.0", issue: 9, candidate: "abc1234def" };

function signed(files) {
  const challenge = { cid: "c1", nonce: "n1", project: "app", v: 2, kjVersion: "5.5.0", issuedMs: 1, expiresMs: 2 };
  return { ...challenge, signer, signature: sign(null, Buffer.from(canonicalPayload({ ...challenge, files }), "utf8"), privateKey).toString("base64") };
}
const body = renderApproval({ ...approval, signature: signed(approvalFiles(approval)) });
// Blocks anyone can post that kj never writes; a nested field in a roster passkey's signature would break its payload.
const passkeys = [{ credentialId: "cred1", publicKey: "", alg: -7 }];
const malformed = [null, [], { ...approval, signature: ["x"] }, { ...approval, signature: { type: "webauthn", credentialId: "cred1", cid: { toString: 1 } } }]
  .map((value) => `\`\`\`kj-release-approval\n${JSON.stringify(value)}\n\`\`\``);

describe("release approval", () => {
  it("a comment signed by a roster key over this release is a valid approval, and names its signer, whatever else is posted", () => {
    expect(findValidApproval({ bodies: ["ok", ...malformed, body], ...approval, keys, passkeys })).toEqual({ ok: true, signer });
  });

  it("is not valid for another version, issue or candidate, a key outside the roster, a changed field or a block kj never writes", () => {
    expect(findValidApproval({ bodies: [body], ...approval, version: "1.3.0", keys }).ok).toBe(false);
    expect(findValidApproval({ bodies: [body], ...approval, issue: 10, keys }).ok).toBe(false);
    expect(findValidApproval({ bodies: [body], ...approval, candidate: "fff0000", keys }).ok).toBe(false);
    expect(findValidApproval({ bodies: [body], ...approval, keys: new Set() })).toMatchObject({ ok: false, reason: expect.stringMatching(/1\.2\.0/) });
    const changed = body.replace('"issue": 9', '"issue": 10');
    expect(findValidApproval({ bodies: [changed], ...approval, issue: 10, keys }).ok).toBe(false);
    expect(findValidApproval({ bodies: ["plain", ...malformed], ...approval, keys, passkeys })).toMatchObject({ ok: false, reason: expect.stringMatching(/no signed approval/) });
  });
});
