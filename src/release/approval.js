/**
 * HU-4188 (ADR 0057, step 5): the approval of a release, signed on the phone over its repo, version, issue and
 * candidate. It travels as a comment of the release issue; CI verifies it with no network against the roster (step 6).
 */
import { createHash } from "node:crypto";
import { verifySignedFiles } from "../harden/phone-sign.js";

const FENCE = /```kj-release-approval\n([\s\S]*?)\n```/g;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** What the phone signs: one entry naming the release, whose hash binds the issue and the candidate. */
export const approvalFiles = ({ repo, version, issue, candidate }) => [
  { file: `release-approval/${repo}@${version}`, sha256: sha256(`${repo}@${version}#${issue}@${candidate}`) },
];

/** The issue comment: the conclusion first, then the signed approval as a block. */
export function renderApproval({ repo, version, issue, candidate, signature }) {
  const block = JSON.stringify({ v: 1, repo, version, issue, candidate, signature }, null, 2);
  return `Release ${version} approved at ${candidate.slice(0, 7)}, signed on the maintainer's phone.\n\n\`\`\`kj-release-approval\n${block}\n\`\`\``;
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isFlat = (value) => isObject(value) && Object.values(value).every((field) => typeof field !== "object");
// Anyone can post a block on the issue: only an object with a flat signature, as kj writes it, is read (a nested field breaks its verification).
const blocksOf = (bodies) => bodies.flatMap((body) => [...String(body ?? "").matchAll(FENCE)].flatMap((m) => {
  try { return [JSON.parse(m[1])]; } catch { return []; }
})).filter((block) => isObject(block) && isFlat(block.signature));

/**
 * The first approval among the bodies that names exactly this release and is signed by a key of
 * the roster or one of its live `passkeys`.
 * @returns {{ok: true, signer: string} | {ok: false, reason: string}}
 */
export function findValidApproval({ bodies, repo, version, issue, candidate, keys, passkeys = [] }) {
  const blocks = blocksOf(bodies).filter((b) => b.repo === repo && b.version === version && b.issue === issue && b.candidate === candidate);
  if (blocks.length === 0) return { ok: false, reason: `no signed approval for ${version} at ${candidate.slice(0, 7)}` };
  let reason = "";
  for (const block of blocks) {
    const verdict = verifySignedFiles({ sig: block.signature, files: approvalFiles(block), keys, passkeys });
    if (verdict.ok) return { ok: true, signer: block.signature.signer ?? block.signature.credentialId };
    reason = verdict.reason;
  }
  return { ok: false, reason: `the approval of ${version} ${reason}` };
}
