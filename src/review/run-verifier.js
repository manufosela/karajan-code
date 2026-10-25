/**
 * KJC-TSK-1195 (#2369, part 2): runs the finding verifier of a third-party review.
 * The verifier must be of another provider family than the reviewer (the same
 * family repeats the same blind spots); it is asked once, with every finding and
 * its hunk, and its answer goes through applyVerification. A verifier that fails
 * leaves the review as it was, every finding unverified, and says why.
 */
import { createAgent } from "../agents/index.js";
import { agentFamily, modelFamily } from "../config/role-resolver.js";
import { applyVerification, buildVerifierPrompt } from "./finding-verifier.js";

/** The model names the family when it is recognised; otherwise the CLI does; null when neither says. */
export const familyOf = (provider, model = null) => (model && modelFamily(model)) || agentFamily(provider);

/** The verdicts in the verifier's answer: the JSON array, even wrapped in prose or a fence; else none. */
export function parseVerdicts(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Throws when the verifier is the reviewer's family; warns when either family cannot be told. */
export function assertCrossFamily({ reviewer, reviewerModel = null, verifier, verifierModel = null, logger }) {
  const theirs = familyOf(reviewer, reviewerModel);
  const mine = familyOf(verifier, verifierModel);
  if (theirs && theirs === mine) {
    throw new Error(`--verifier ${verifier} is the same family (${mine}) as the reviewer ${reviewer}: it would repeat its blind spots; pick another family`);
  }
  if (!theirs || !mine) logger?.warn?.(`--verifier: the family of ${mine ? reviewer : verifier} cannot be told; make sure it differs from the reviewer's`);
}

/** The findings after the verifier, and the verification block. */
export async function verifyFindings({ findings, diff, verifier, model = null, config, logger, createAgentFn = createAgent }) {
  const cfg = { ...config, roles: { ...config?.roles, reviewer: { provider: verifier, model } } };
  let res;
  try {
    res = await createAgentFn(verifier, cfg, logger).reviewTask({ prompt: buildVerifierPrompt(findings, diff), role: "reviewer" });
  } catch (err) {
    res = { ok: false, error: err.message };
  }
  if (!res?.ok) {
    const out = applyVerification(findings, [], { verifier, model });
    return { ...out, verification: { ...out.verification, error: String(res?.error ?? "the verifier gave no answer") } };
  }
  return applyVerification(findings, parseVerdicts(res.output), { verifier, model });
}
