// BOOT-D (KJC-TSK-0863, ADR "el proyecto se arranca y se prueba como lo haría
// una persona") — green is not proof. The Anthropic write-up reports the agent
// marking features complete without checking them, and this codebase has the
// same hole: a card whose result a person SEES is closed on a green suite.
//
// kj does not drive the browser (the host already has Chrome DevTools). kj
// DEMANDS and RECORDS the evidence, bound to the diff like sonar and rag, and
// it warns rather than blocks: the article itself admits the browser misses
// native modals, so this is the last proof, never the only one.
import { describe, it, expect } from "vitest";
import { checkUiEvidence, uiBlock, UI_RULE_ID } from "../../src/review/ui-evidence.js";

const front = ["src/ui/Login.jsx", "src/styles/login.css"];
const back = ["src/server/auth.js"];
const grant = (expiresAt) => ({ rule_id: UI_RULE_ID, scopeKind: "permanente", expiresAt, who: { git: "human" } });

describe("ui-evidence requirement", () => {
  it("a diff nobody sees needs no walkthrough", () => {
    expect(checkUiEvidence({ stagedFiles: back })).toMatchObject({ ok: true, mode: "not-visible" });
  });

  it("a visible diff with no evidence WARNS, naming what to record", () => {
    const r = checkUiEvidence({ stagedFiles: front });
    expect(r).toMatchObject({ ok: true, mode: "missing" });
    expect(r.warn).toBe(true);
    expect(r.reason).toMatch(/recorrido/i);
    expect(r.reason).toMatch(/Login\.jsx/);
  });

  it("evidence of the walkthrough passes, and says what was walked", () => {
    const r = checkUiEvidence({ stagedFiles: front, evidence: { walked: ["entrar con magic link"], tool: "chrome-devtools" } });
    expect(r).toMatchObject({ ok: true, mode: "walked" });
    expect(r.warn).toBeFalsy();
  });

  it("an empty walkthrough is not evidence", () => {
    const r = checkUiEvidence({ stagedFiles: front, evidence: { walked: [], tool: "chrome-devtools" } });
    expect(r.mode).toBe("missing");
  });

  it("a live human grant lifts it, like every other rule of the method", () => {
    const r = checkUiEvidence({ stagedFiles: front, standingExceptions: [grant("2999-01-01T00:00:00Z")] });
    expect(r).toMatchObject({ ok: true, mode: "granted" });
    expect(r.warn).toBeFalsy();
  });

  it("an expired grant is not a grant", () => {
    expect(checkUiEvidence({ stagedFiles: front, standingExceptions: [grant("2000-01-01T00:00:00Z")] }).mode).toBe("missing");
  });

  it("the block that travels in the verdict carries what was walked and with what", () => {
    const req = checkUiEvidence({ stagedFiles: front, evidence: { walked: ["entrar", "salir"], tool: "chrome-devtools" } });
    expect(uiBlock(req)).toEqual({ mode: "walked", walked: ["entrar", "salir"], tool: "chrome-devtools", visible: front });
  });

  it("no block for a diff nobody sees: nothing to record", () => {
    expect(uiBlock(checkUiEvidence({ stagedFiles: back }))).toBeNull();
  });
});
