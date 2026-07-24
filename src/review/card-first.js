/**
 * Card-first gate (KJC-TSK-0686, MG-A of épica KJC-PCS-0068). v3 obeyed
 * but couldn't think; v4 thinks but narrates — so the rule that every
 * piece of work starts from a card stops living in playbook text and
 * moves into the gate. With hu-board the check is fully deterministic:
 * the branch must reference a LIVE card (block by default). With
 * planning-game/external boards, liveness can't be verified locally, so
 * a card-shaped reference is required (warn by default, block via
 * `method_gates.card_first`). Exemptions are explicit and visible:
 * configured branch prefixes (releases) and KJ_ALLOW_NO_CARD=1.
 */
import { listPlans, loadPlan } from "../plan/plan-store.js";
import { escapeRegExp } from "../utils/escape-regexp.js";

const LIVE_STATUSES = new Set(["pending", "running", "failed"]);
// Card-shaped reference: LIN-123, KJC-TSK-0684, bb-002… anchored on a
// letter, short alnum head, dash, digits — tight enough to skip slugs.
const CARD_REF_RE = /\b[a-z][a-z0-9]{1,9}-\d{1,6}\b/i;
const DEFAULT_EXEMPT_PREFIXES = ["chore/release-"];

// Token-boundary match: BB-002 must not satisfy a branch that actually
// references BB-0022 (reviewer catch — substring matching allowed work
// onto the wrong card).
function refInBranch(ref, branchLower) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(String(ref).toLowerCase())}([^a-z0-9]|$)`).test(branchLower);
}

async function findLiveCardInBranch(projectDir, branch) {
  const needle = branch.toLowerCase();
  // Scan EVERY match before deciding: any live reference satisfies the
  // gate; a closed one is only reported when no live match exists
  // (reviewer catch — first-match could reject a branch that also
  // references a live card, depending on plan iteration order).
  let closedHit = null;
  for (const meta of await listPlans(projectDir)) {
    const plan = await loadPlan(projectDir, meta.planId);
    for (const h of plan.hus || []) {
      for (const ref of [h.short_id, h.id]) {
        if (ref && refInBranch(ref, needle)) {
          if (LIVE_STATUSES.has(h.status)) return { ref, live: true, status: h.status };
          closedHit = { ref, live: false, status: h.status };
        }
      }
    }
  }
  return closedHit;
}

export async function checkCardFirst({ config = {}, projectDir = process.cwd(), branch, env = process.env }) {
  if (env.KJ_ALLOW_NO_CARD === "1") {
    return { ok: true, mode: "exempt", reason: "KJ_ALLOW_NO_CARD=1 (explicit escape hatch)" };
  }
  const exempt = config.method_gates?.card_first_exempt_branches || DEFAULT_EXEMPT_PREFIXES;
  if (exempt.some((p) => branch.startsWith(p))) {
    return { ok: true, mode: "exempt", reason: `branch prefix exempt (${branch.split("/")[0]}/…)` };
  }
  // The base branch belongs to the branch-first gate — card-first here
  // would only double-report (and HEAD covers detached checkouts in CI).
  if ([config.base_branch || "main", "main", "master", "HEAD"].includes(branch)) {
    return { ok: true, mode: "exempt", reason: "base branch — the branch-first gate owns this case" };
  }

  const backend = config.state_backend || "hu-board";
  const policy = config.method_gates?.card_first || "auto";

  if (backend === "hu-board") {
    const hit = await findLiveCardInBranch(projectDir, branch);
    if (hit?.live) return { ok: true, mode: "pass", ref: hit.ref };
    const effective = policy === "auto" ? "block" : policy;
    const reason = hit
      ? `branch references ${hit.ref} but its card is "${hit.status}" — card-first needs a live card (reopen it or create one: kj hu add)`
      : `no live card referenced in branch "${branch}" — create it first (kj hu add "…" --id <REF>) and name the branch after it`;
    return effective === "block"
      ? { ok: false, mode: "block", reason }
      : { ok: true, mode: "warn", reason };
  }

  // planning-game / external: presence check only — liveness lives in the
  // project's own board, out of local reach.
  if (CARD_REF_RE.test(branch)) return { ok: true, mode: "pass", ref: branch.match(CARD_REF_RE)[0] };
  const effective = policy === "auto" ? "warn" : policy;
  const boardName = config.board?.name || backend;
  const reason = `no card reference in branch "${branch}" — card-first on ${boardName}: create the card there and name the branch after it (e.g. feat/ABC-123-summary)`;
  return effective === "block"
    ? { ok: false, mode: "block", reason }
    : { ok: true, mode: "warn", reason };
}
