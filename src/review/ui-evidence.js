/**
 * BOOT-D (KJC-TSK-0863) — the done-statement of something a person SEES is not
 * proved by a green suite.
 *
 * The Anthropic write-up on long-running agents reports it as an observed
 * failure: the agent marked features complete without checking them. This
 * codebase has the same hole. `impeccable` gives an AI OPINION about the diff,
 * which is precisely what KJC-TSK-0726 rejects; what is missing is the proof
 * that the route works when a person walks it.
 *
 * kj does not drive the browser: the host already has Chrome DevTools, and
 * duplicating that would tie kj to one runner. kj DEMANDS the evidence and
 * records it in the verdict, bound to the diff, exactly as it does with sonar
 * and rag.
 *
 * It WARNS, it does not block. The article itself admits the browser misses
 * native modals, so this is the last proof, never the only one — and a gate
 * that fails often teaches people to skip gates, which is the doctrine behind
 * every other rule here.
 */

export const UI_RULE_ID = "method.ui.evidence";

// What a person can actually see. Deliberately narrow: a false demand costs
// more than a missed one while this only warns.
const VISIBLE = /\.(jsx|tsx|vue|svelte|astro|css|scss|sass|less|html)$/i;

const liveGrant = (standingExceptions, now) => (standingExceptions || []).find((e) => {
  if (e?.rule_id !== UI_RULE_ID) return false;
  const until = Date.parse(e?.expiresAt ?? "");
  return Number.isFinite(until) && until > now.getTime();
});

/**
 * @returns {{ok: boolean, mode: "not-visible"|"walked"|"granted"|"missing", visible: string[], warn?: boolean, reason?: string, evidence?: object, grant?: object}}
 */
export function checkUiEvidence({ stagedFiles = [], evidence = null, standingExceptions = [], now = new Date() } = {}) {
  const visible = stagedFiles.filter((f) => VISIBLE.test(String(f)));
  if (visible.length === 0) return { ok: true, mode: "not-visible", visible };

  const walked = Array.isArray(evidence?.walked) ? evidence.walked.filter(Boolean) : [];
  if (walked.length > 0) return { ok: true, mode: "walked", visible, evidence: { walked, tool: evidence.tool ?? null } };

  const grant = liveGrant(standingExceptions, now);
  if (grant) return { ok: true, mode: "granted", visible, grant };

  return {
    ok: true,
    warn: true,
    mode: "missing",
    visible,
    reason: `verde no es prueba: ${visible.length} fichero(s) que una persona VE (${visible.join(", ")}) sin recorrido comprobado — recórrelo como lo haría ella y deja constancia`,
  };
}

/** The block that travels inside the verdict, bound to the diff like sonar's. */
export function uiBlock(req) {
  if (!req || req.mode === "not-visible") return null;
  return {
    mode: req.mode,
    walked: req.evidence?.walked ?? [],
    tool: req.evidence?.tool ?? null,
    visible: req.visible ?? [],
  };
}
