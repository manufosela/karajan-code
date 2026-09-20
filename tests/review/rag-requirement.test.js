// KJC-TSK-0849 (ADR 0010, RAG-C): a diff with code enters the review only if
// the session's RAG ledger shows the RAG answered about every staged source
// (file or sibling); new files need one consultation; docs-only is exempt;
// the only other way through is a human grant, never an env var.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkRagRequirement, checkRagVerdict, ragBlock, RAG_RULE_ID } from "../../src/review/rag-requirement.js";
import { readRagLedger } from "../../src/review/rag-ledger.js";

const ledger = (hits, queries = 1) => ({ available: true, sessionId: "s1", hits, queries: Array.from({ length: queries }, () => ({ text: "q", hits })) });
const grant = (expiresAt) => ({ rule_id: RAG_RULE_ID, scopeKind: "permanente", expiresAt, who: { git: "human" } });

describe("checkRagRequirement", () => {
  it("a docs-only diff needs no consultation", () => {
    expect(checkRagRequirement({ stagedFiles: ["README.md", "docs/x.md"], ledger: { available: false } })).toMatchObject({ ok: true, mode: "docs-only" });
  });

  it("passes when every staged source was returned, itself or through a sibling, and names the untouched twins", () => {
    const r = checkRagRequirement({ stagedFiles: ["src/a.js", "src/b.js", "README.md"], ledger: ledger(["src/a.js", "scripts/postinstall.js"], 2) });
    expect(r).toMatchObject({ ok: true, mode: "pass", queries: 2, covered: ["src/a.js", "src/b.js"], uncovered: [], twinsUntouched: ["scripts/postinstall.js"] });
  });

  it("blocks code without a ledger, naming the consultation and the only way through", () => {
    const r = checkRagRequirement({ stagedFiles: ["src/a.js"], ledger: { available: false, reason: "the sentinel state holds no session" } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/The RAG must have answered about code/);
    expect(r.reason).toContain("the sentinel state holds no session");
    expect(r.reason).toContain(`kj policy grant --rule ${RAG_RULE_ID}`);
  });

  it("blocks when no query returned a staged source, listing it", () => {
    const r = checkRagRequirement({ stagedFiles: ["src/a.js", "packages/x/src/b.js"], ledger: ledger(["src/a.js"]) });
    expect(r.ok).toBe(false);
    expect(r.uncovered).toEqual(["packages/x/src/b.js"]);
    expect(r.reason).toContain("packages/x/src/b.js");
  });

  it("a file NEW in the diff only needs the session to have consulted at all", () => {
    expect(checkRagRequirement({ stagedFiles: ["lib/new.js"], newFiles: ["lib/new.js"], ledger: ledger(["src/a.js"]) }).ok).toBe(true);
    expect(checkRagRequirement({ stagedFiles: ["lib/new.js"], newFiles: ["lib/new.js"], ledger: ledger([], 0) }).ok).toBe(false);
  });

  it("a live human grant lets code through; an expired one, another rule, or any env var do not", () => {
    const now = new Date("2026-09-17T00:00:00Z");
    const base = { stagedFiles: ["src/a.js"], ledger: { available: false, reason: "x" }, now };
    expect(checkRagRequirement({ ...base, standingExceptions: [grant("2999-01-01T00:00:00Z")] })).toMatchObject({ ok: true, mode: "granted" });
    expect(checkRagRequirement({ ...base, standingExceptions: [grant("2026-01-01T00:00:00Z")] }).ok).toBe(false);
    expect(checkRagRequirement({ ...base, standingExceptions: [{ ...grant("2999-01-01T00:00:00Z"), rule_id: "method.sonar.code" }] }).ok).toBe(false);
    const overridden = checkRagRequirement({ ...base, env: { KJ_ALLOW_NO_RAG: "1", KJ_ALLOW_POLICY: "1" } });
    expect(overridden.ok).toBe(false);
    expect(overridden.reason).toContain("KJ_ALLOW_NO_RAG, KJ_ALLOW_POLICY is not honoured here");
  });

  it("ragBlock carries the evidence and the session, bound later to the diff hash like sonar", () => {
    const req = checkRagRequirement({ stagedFiles: ["src/a.js"], ledger: ledger(["src/a.js", "src/z.js"]) });
    expect(ragBlock(req, ledger([]))).toEqual({ mode: "pass", sessionId: "s1", queries: 1, covered: ["src/a.js"], uncovered: [], twinsUntouched: ["src/z.js"] });
  });
});

describe("harness states", () => {
  // KJC-BUG-0192: an absent harness used to PASS, so not hardening (or
  // kj init --no-harden) was the comfortable way around the gate. Nobody
  // installed to record the session is a reason to install it, or to ask for
  // a grant — never a silent exemption.
  it("blocks without a harness, and fails closed when the harness does not match the installed kj", () => {
    const staged = ["src/a.js", "src/b.js"];
    const noHarness = checkRagRequirement({ stagedFiles: staged, ledger: { harness: false, available: false } });
    expect(noHarness.ok).toBe(false);
    expect(noHarness.reason).toMatch(/kj harden/);
    expect(noHarness.reason).toMatch(/policy grant/);
    // A live grant is the declared way out, and it still works.
    expect(checkRagRequirement({ stagedFiles: staged, ledger: { harness: false, available: false }, standingExceptions: [grant("2999-01-01T00:00:00Z")] }))
      .toMatchObject({ ok: true, mode: "granted" });
    // An empty dir, an edited hook or one older than the ledger vouches for nothing.
    const r = checkRagRequirement({ stagedFiles: staged, ledger: { harness: true, verified: false, mismatched: ["posttooluse.mjs"], available: true, hits: staged, queries: [{}] } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not match the installed kj \(posttooluse\.mjs\)/);
    expect(checkRagRequirement({ stagedFiles: staged, ledger: { harness: true, verified: false, mismatched: [], available: true, hits: staged, queries: [{}] } }).reason).toMatch(/scripts missing/);
  });
});

describe("checkRagVerdict (the --check side)", () => {
  it("recomputes coverage from the block, demands a block for code, and honours the recorded modes", () => {
    const staged = ["src/a.js", "src/b.js"];
    expect(checkRagVerdict({ stagedFiles: ["README.md"], rag: null })).toMatchObject({ ok: true, mode: "docs-only" });
    expect(checkRagVerdict({ stagedFiles: staged, rag: null }).reason).toMatch(/no rag block/);
    expect(checkRagVerdict({ stagedFiles: staged, rag: { mode: "pass", covered: ["src/a.js"] } }).reason).toContain("src/b.js");
    expect(checkRagVerdict({ stagedFiles: staged, rag: { mode: "pass", covered: staged } })).toMatchObject({ ok: true, mode: "pass" });
    expect(checkRagVerdict({ stagedFiles: staged, rag: null, harness: false }).ok).toBe(false);
    // Only a grant that holds NOW authorizes; a "granted" or "no-harness" the block recorded is a claim that lapsed.
    expect(checkRagVerdict({ stagedFiles: staged, rag: { mode: "granted" }, standingExceptions: [grant("2999-01-01T00:00:00Z")] })).toMatchObject({ ok: true, mode: "granted" });
    expect(checkRagVerdict({ stagedFiles: staged, rag: { mode: "granted" } }).reason).toMatch(/malformed \(mode "granted"/);
    expect(checkRagVerdict({ stagedFiles: staged, rag: { mode: "no-harness" } }).reason).toMatch(/malformed \(mode "no-harness"/);
    // A block with a mode the review never writes is not evidence, however complete its covered list.
    expect(checkRagVerdict({ stagedFiles: staged, rag: { mode: "tampered", covered: staged } }).reason).toMatch(/malformed \(mode "tampered", covered list\)/);
    expect(checkRagVerdict({ stagedFiles: staged, rag: { covered: staged } }).reason).toMatch(/malformed \(mode null/);
    expect(checkRagVerdict({ stagedFiles: staged, rag: { mode: "pass", covered: 7 } }).reason).toMatch(/malformed \(mode "pass", covered number\)/);
    // A harness that does not match the installed kj vouches for nothing, whatever the block says.
    const unverified = checkRagVerdict({ stagedFiles: staged, rag: { mode: "pass", covered: staged }, verified: false, mismatched: ["posttooluse.mjs"] });
    expect(unverified.ok).toBe(false);
    expect(unverified.reason).toMatch(/does not match the installed kj \(posttooluse\.mjs\)/);
  });
});

describe("readRagLedger", () => {
  it("reads the most recently active session of the sentinel state, and says when there is none", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-ledger-"));
    try {
      expect(readRagLedger(dir)).toMatchObject({ harness: false, available: false, hits: [], queries: [] });
      const harness = path.join(dir, ".karajan", "harness");
      fs.mkdirSync(harness, { recursive: true });
      fs.writeFileSync(path.join(harness, "sentinel-state.json"), JSON.stringify({ sessions: {} }));
      expect(readRagLedger(dir).available).toBe(false);
      fs.writeFileSync(path.join(harness, "sentinel-state.json"), JSON.stringify({ sessions: {
        old: { at: 1, rag_hits: ["src/old.js"], rag_queries: [{ text: "o", hits: ["src/old.js"] }] },
        live: { at: 2, rag_hits: ["src/a.js"], rag_queries: [{ text: "a", hits: ["src/a.js"] }] },
        mute: { at: 3 },
      } }));
      // A hand-made harness dir is NOT verified (nothing here matches the installed kj).
      expect(readRagLedger(dir)).toMatchObject({ harness: true, verified: false, available: true, sessionId: "mute", queries: [], hits: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
