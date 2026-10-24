// KJC-TSK-1171 (RAG-B, ADR 0026): every code chunk says where it lives (start_line, end_line)
// and whose it is (parent, the enclosing class), so the embedded header and the citations
// can name them. One helper does the slicing, the windowing and the line math for every
// language adapter.
import { describe, expect, it } from "vitest";
import { spanChunks } from "../../src/lang/chunk-span.js";

const TEXT = "class A {\n  void m() {}\n}\n\nclass B {\n}\n";
const marks = [
  { idx: 0, symbol: "A" },
  { idx: TEXT.indexOf("void m"), symbol: "m", parent: "A" },
  { idx: TEXT.indexOf("class B"), symbol: "B" },
];

describe("spanChunks", () => {
  it("slices from each mark to the next, with 1-based line range and the parent symbol", () => {
    const out = spanChunks(TEXT, marks, { path: "x.java", language: "java" });
    expect(out.map((c) => [c.metadata.symbol, c.metadata.parent, c.metadata.start_line, c.metadata.end_line])).toEqual([
      ["A", null, 1, 1],
      ["m", "A", 2, 3],
      ["B", null, 5, 6],
    ]);
    expect(out[1].metadata).toMatchObject({ source: "x.java", kind: "code", language: "java" });
    expect(out[1].text).toBe("void m() {}\n}\n\n");
  });

  it("windows an oversize body and keeps the line range of each piece", () => {
    const body = Array.from({ length: 6 }, (_, i) => `line${i + 1}`).join("\n"); // 35 chars
    const out = spanChunks(body, [{ idx: 0, symbol: "f" }], { path: "x.js", limit: 20, overlap: 5 });
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].metadata.start_line).toBe(1);
    expect(out.at(-1).metadata.end_line).toBe(6);
    for (const c of out) expect(c.metadata.end_line).toBeGreaterThanOrEqual(c.metadata.start_line);
  });

  it("with no marks, windows the whole text as one anonymous symbol", () => {
    const out = spanChunks("// only a comment\n", [], { path: "x.js", language: "javascript" });
    expect(out).toEqual([{ text: "// only a comment\n", metadata: { source: "x.js", kind: "code", symbol: null, parent: null, language: "javascript", start_line: 1, end_line: 1 } }]);
  });
});
