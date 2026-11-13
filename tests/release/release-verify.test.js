// HU-4190 (ADR 0057, step 6): CI checks a tag against its release issue and the signed approval.
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { approvalFiles, renderApproval } from "../../src/release/approval.js";
import { renderAnswer } from "../../src/release/answers.js";
import { renderProposal } from "../../src/release/proposal.js";
import { releaseVerifyCommand } from "../../src/commands/release-verify.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const signer = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
const repo = "acme/app";
const candidate = "abc1234def5678";
const deadline = Date.parse("2026-11-13T12:00:00Z");
const after = deadline + 1000;

function approvalComment(version = "1.2.0", issue = 9) {
  const files = approvalFiles({ repo, version, issue, candidate });
  const challenge = { cid: "c1", nonce: "n1", project: "app", v: 2, kjVersion: "5.5.0", issuedMs: 1, expiresMs: 2 };
  const signature = { ...challenge, signer, signature: sign(null, Buffer.from(canonicalPayload({ ...challenge, files }), "utf8"), privateKey).toString("base64") };
  return { login: "maintainer", body: renderApproval({ repo, version, issue, candidate, signature }) };
}
const answer = (login, decision) => ({ login, body: renderAnswer({ decision, candidate }) });
const proposalBody = (version) => renderProposal({ repo, version, tag: "v1.1.0", head: candidate, goingOut: [], stayingOut: [], participants: ["ana", "bob"], deadline });

function world({ issues = [{ number: 9, title: "Release 1.2.0", pull: false }], body = proposalBody("1.2.0"), comments = [answer("ana", "ok"), answer("bob", "ok"), approvalComment()], commit = candidate } = {}) {
  const gh = async (args) => {
    const path = args.find((a) => a.startsWith("repos/"));
    if (path.includes("/comments")) return comments.map((c) => JSON.stringify({ ...c, createdAt: "2026-11-13T10:00:00Z" })).join("\n");
    if (path.includes("issues?")) return issues.map((i) => JSON.stringify(i)).join("\n");
    return JSON.stringify({ body });
  };
  const git = () => commit;
  return { repo, tag: "v1.2.0", projectDir: "/p", now: after, gh, git, keys: new Set([signer]), passkeys: [], print: () => {} };
}
const verify = (overrides, patch = {}) => releaseVerifyCommand({ ...world(overrides), ...patch });

describe("kj release verify", () => {
  it("passes with a ready release and a valid approval at the tag's commit", async () => {
    expect(await verify()).toEqual({ ok: true, version: "1.2.0", issue: 9, signer });
  });

  it("prints one line with the reason", async () => {
    const lines = [];
    await verify({}, { print: (line) => lines.push(line), tag: "1.2.0" });
    expect(lines).toEqual([expect.stringMatching(/^release verify: .*not a release tag/)]);
  });

  it.each([
    ["a bad tag", {}, { tag: "1.2.0" }, /not a release tag/],
    ["no issue", { issues: [] }, {}, /no release issue/],
    ["a pull request is not the issue", { issues: [{ number: 9, title: "Release 1.2.0", pull: true }] }, {}, /no release issue/],
    ["two issues", { issues: [{ number: 9, title: "Release 1.2.0" }, { number: 12, title: "Release 1.2.0" }] }, {}, /#9, #12/],
    ["a proposal for another version", { body: proposalBody("1.3.0") }, {}, /for 1\.3\.0/],
    ["the tag on another commit", { commit: "fff0000aaa" }, {}, /fff0000/],
    ["a hold", { comments: [answer("ana", "ok"), answer("bob", "hold"), approvalComment()] }, {}, /hold by @bob/],
    ["a hold after the approval", { comments: [answer("ana", "ok"), answer("bob", "ok"), approvalComment(), answer("bob", "hold")] }, {}, /hold by @bob/],
    ["silence before the deadline", { comments: [answer("ana", "ok"), approvalComment()] }, { now: deadline - 1000 }, /@bob/],
    ["no approval", { comments: [answer("ana", "ok"), answer("bob", "ok")] }, {}, /no signed approval/],
    ["a key out of the roster", {}, { keys: new Set([other]) }, /approval of 1\.2\.0/],
    ["an empty roster", {}, { keys: new Set() }, /roster has no signers/],
  ])("fails with %s", async (_name, overrides, patch, reason) => {
    const result = await verify(overrides, patch);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it.each([
    ["every duplicate issue", { issues: [{ number: 9, title: "Release 1.2.0" }, { number: 12, title: "Release 1.2.0" }] }, {}, "several release issues for 1.2.0: #9, #12"],
    ["every holder", { comments: [answer("ana", "hold"), answer("bob", "hold"), approvalComment()] }, {}, "on hold by @ana, @bob"],
    ["every silent participant", { comments: [approvalComment()] }, { now: deadline - 1000 }, "not everyone answered: @ana, @bob until 2026-11-13T12:00:00.000Z"],
  ])("names %s in the reason", async (_name, overrides, patch, reason) => {
    expect((await verify(overrides, patch)).reason).toBe(reason);
  });
});
