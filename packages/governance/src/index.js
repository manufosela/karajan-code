/**
 * @karajan/governance — governance kernel for agent actions (ADR 0003,
 * epic KJC-PCS-0076). The kernel knows exactly three concepts, all
 * abstract: Policy (declarative, versioned, closed fail-loud vocabulary,
 * with a non-exemptable subset), Decision (deterministic evaluation of an
 * action against a policy — local, no network, no LLM) and Exception (a
 * first-class object: who approved, exact rule, justification written at
 * the moment, scope with expiry, hash of the affected artifact). What an
 * artifact IS belongs to each domain adapter; here it is only an
 * identifiable, hashable reference. karajan-code is the first consumer,
 * not the owner.
 */
export { globToRegExp, matchesAny, commandPatternToRegExp } from "./glob.js";
export { parsePolicy, evalWrite, evalShell, checkArtifacts, ALLOW_VERDICT, denyVerdict, DEFAULT_POLICY } from "./engine.js";
