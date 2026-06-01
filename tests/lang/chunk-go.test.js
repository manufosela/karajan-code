// KJC-PCS-0052 PR-B.2.3 — Go chunker. Mismo split que chunk-rust.test:
// regex tests (camino síncrono sin prepareGo) + AST tests (tras
// `await prepareGo()`). Verifica func / method / type top-level y
// el routing desde chunkSource al pasar un .go.

import { beforeAll, describe, expect, it } from "vitest";

import { chunkGo, prepareGo } from "../../src/lang/chunk-go.js";
import { chunkSource } from "../../src/rag/chunker.js";

describe("chunkGo — KJC-PCS-0052 PR-B.2.3", () => {
  it("emits one chunk per top-level func/method/type with metadata.symbol", () => {
    const text = "func alpha() {}\n\nfunc (r *Recv) beta() {}\n\ntype Gamma struct { x int }\n";
    const chunks = chunkGo(text, { path: "x.go" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["alpha", "beta", "Gamma"]);
    expect(chunks[0].text).toContain("func alpha");
    expect(chunks[1].text).toContain("func (r *Recv) beta");
    expect(chunks[2].text).toContain("type Gamma struct");
    for (const c of chunks) {
      expect(c.metadata.language).toBe("go");
      expect(c.metadata.kind).toBe("code");
      expect(c.metadata.source).toBe("x.go");
    }
  });

  it("falls back to windowText when no top-level items exist", () => {
    const text = "// just a comment\nimport \"fmt\"\n";
    const chunks = chunkGo(text, { path: "s.go" });
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe(null);
    expect(chunks[0].metadata.language).toBe("go");
  });

  it("windows oversized bodies (limit boundary)", () => {
    const body = "x".repeat(2000);
    const text = `func huge() {\n    s := "${body}"\n    _ = s\n}\n`;
    const chunks = chunkGo(text, { path: "h.go", limit: 200, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.metadata.symbol).toBe("huge");
  });
});

describe("chunkSource adapter dispatch — Go", () => {
  it("routes .go files through chunkGo (symbol metadata present, language=go)", () => {
    const text = "func alpha() {}\n\nfunc beta() {}\n";
    const chunks = chunkSource(text, { path: "/tmp/x.go" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["alpha", "beta"]);
    expect(chunks[0].metadata.language).toBe("go");
  });
});

describe("chunkGo AST — KJC-PCS-0052 PR-B.2.3", () => {
  beforeAll(async () => {
    await prepareGo();
  });

  it("captures method_declaration with the method name as symbol", () => {
    const text = "type Foo struct{}\n\nfunc (f *Foo) Bar() int { return 1 }\n\nfunc (f Foo) Baz() string { return \"x\" }\n";
    const chunks = chunkGo(text, { path: "i.go" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Foo", "Bar", "Baz"]);
    expect(chunks[1].text).toContain("func (f *Foo) Bar");
    expect(chunks[2].text).toContain("func (f Foo) Baz");
  });

  it("uses the first type_spec name when the type block has multiple specs", () => {
    const text = "type (\n    Alpha int\n    Beta  string\n)\n\nfunc gamma() {}\n";
    const chunks = chunkGo(text, { path: "a.go" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Alpha", "gamma"]);
    expect(chunks[0].text).toContain("type (");
  });
});
