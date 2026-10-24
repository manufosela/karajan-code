// KJC-TSK-1171 (RAG-B, ADR 0026): the embedder reads a header with path, language, parent,
// symbol and lines before the body; the body stored for the agent stays untouched.
import { describe, expect, it } from "vitest";
import { embedHeader, embedText, EMBED_SCHEMA } from "../../src/rag/embed-header.js";

describe("embedHeader", () => {
  it("names path (relative to the root), language, parent.symbol and the line range of a code chunk", () => {
    const metadata = { source: "/repo/src/billing/tax.js", kind: "code", symbol: "vatRateFor", parent: null, start_line: 5, end_line: 9 };
    expect(embedHeader(metadata, { root: "/repo" })).toBe("src/billing/tax.js · javascript · vatRateFor · L5-9");
    const method = { source: "/repo/src/Main.java", kind: "code", language: "java", symbol: "run", parent: "Alpha", start_line: 2, end_line: 2 };
    expect(embedHeader(method, { root: "/repo" })).toBe("src/Main.java · java · Alpha.run · L2");
  });

  it("names the heading path of a markdown chunk and the story of a plan chunk", () => {
    expect(embedHeader({ source: "/repo/docs/billing.md", kind: "code", headingPath: ["Billing", "Refunds"] }, { root: "/repo" })).toBe("docs/billing.md · markdown · Billing > Refunds");
    expect(embedHeader({ source: "/home/u/.karajan/plans/p.json", kind: "plan", hu_id: "HU-3", title: "Login" }, { root: "/repo" })).toMatch(/plans\/p\.json · json · HU-3 Login$/);
  });

  it("embedText prepends the header to the body and leaves a chunk with no source as it is", () => {
    const chunk = { text: "export const a = 1;\n", metadata: { source: "/repo/a.js", kind: "code", symbol: "a", start_line: 1, end_line: 1 } };
    expect(embedText(chunk, { root: "/repo" })).toBe("a.js · javascript · a · L1\n\nexport const a = 1;\n");
    expect(embedText({ text: "loose", metadata: {} })).toBe("loose");
    expect(EMBED_SCHEMA).toBe(2);
  });
});
