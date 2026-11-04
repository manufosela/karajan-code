/**
 * KJC-TSK-1402 (ADR 0037 layer 2): a merge that skips its required checks on purpose (an admin
 * merge in a transition) carries the maintainer's exception. The phone signs the repo, the PR,
 * its head commit and the reason; the signature travels as a PR comment, so no commit and no
 * seal are needed, and main-guard checks it in CI with no network against the repo's roster.
 * A later push to the PR changes its head and voids the exception.
 */
import { createHash } from "node:crypto";

import { verifySignedFiles } from "../harden/phone-sign.js";

const FENCE = /```kj-exception\n([\s\S]*?)\n```/g;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** What the phone signs: one entry naming the PR, whose hash binds the head commit and the reason. */
export const exceptionFiles = ({ repo, pr, head, why }) => [
  { file: `main-guard-exception/${repo}#${pr}`, sha256: sha256(`${repo}#${pr}@${head}\n${why}`) },
];

/** The PR comment: the conclusion first, then the signed exception as a block. */
export function renderException({ repo, pr, head, why, signature }) {
  const block = JSON.stringify({ v: 1, repo, pr, head, why, signature }, null, 2);
  return `main-guard exception for #${pr} at ${head.slice(0, 7)}, signed on the maintainer's phone: ${why}\n\n\`\`\`kj-exception\n${block}\n\`\`\``;
}

const blocksOf = (bodies) => bodies.flatMap((body) => [...String(body ?? "").matchAll(FENCE)].flatMap((m) => {
  try { return [JSON.parse(m[1])]; } catch { return []; }
}));

/**
 * The first exception among the PR's comments that covers this PR and head and is signed by a
 * key of the roster.
 * @returns {{ok: true, why: string, signer: string} | {ok: false, reason: string}}
 */
export function findValidException({ bodies, repo, pr, head, keys }) {
  const blocks = blocksOf(bodies).filter((b) => b.repo === repo && b.pr === pr && b.head === head);
  if (blocks.length === 0) return { ok: false, reason: `no signed exception for #${pr} at ${head.slice(0, 7)}` };
  let reason = "";
  for (const block of blocks) {
    const verdict = verifySignedFiles({ sig: block.signature, files: exceptionFiles(block), keys });
    if (verdict.ok) return { ok: true, why: block.why, signer: block.signature.signer };
    reason = verdict.reason;
  }
  return { ok: false, reason: `the exception for #${pr} ${reason}` };
}
