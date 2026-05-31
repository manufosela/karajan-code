// KJC-PCS-0052 PR-B.2.2 — Rust chunker. Mismo split que chunk-python.test:
// regex tests (camino síncrono sin prepareRust) + AST tests (tras
// `await prepareRust()`). Mantiene backward-compat regex y verifica que
// AST captura impl_item (que no tiene field `name`) usando `type`.

import { beforeAll, describe, expect, it } from "vitest";

import { chunkRust, prepareRust } from "../../src/lang/chunk-rust.js";
import { chunkSource } from "../../src/rag/chunker.js";

describe("chunkRust — KJC-PCS-0052 PR-B.2.2", () => {
  it("emits one chunk per top-level fn/struct/enum/trait with metadata.symbol", () => {
    const text = "fn alpha() { 1 }\n\nstruct Beta;\n\nenum Gamma { A, B }\n\ntrait Delta { fn d(&self); }\n";
    const chunks = chunkRust(text, { path: "x.rs" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["alpha", "Beta", "Gamma", "Delta"]);
    expect(chunks[0].text).toContain("fn alpha");
    expect(chunks[1].text).toContain("struct Beta");
    for (const c of chunks) {
      expect(c.metadata.language).toBe("rust");
      expect(c.metadata.kind).toBe("code");
      expect(c.metadata.source).toBe("x.rs");
    }
  });

  it("falls back to windowText when no top-level items exist", () => {
    const text = "// just a comment\nuse std::io;\n";
    const chunks = chunkRust(text, { path: "s.rs" });
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe(null);
    expect(chunks[0].metadata.language).toBe("rust");
  });

  it("windows oversized bodies (limit boundary)", () => {
    const body = "x".repeat(2000);
    const text = `fn huge() {\n    let s = "${body}";\n}\n`;
    const chunks = chunkRust(text, { path: "h.rs", limit: 200, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.metadata.symbol).toBe("huge");
  });
});

describe("chunkSource adapter dispatch — Rust", () => {
  it("routes .rs files through chunkRust (symbol metadata present, language=rust)", () => {
    const text = "fn alpha() { 1 }\n\nfn beta() { 2 }\n";
    const chunks = chunkSource(text, { path: "/tmp/x.rs" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["alpha", "beta"]);
    expect(chunks[0].metadata.language).toBe("rust");
  });
});

describe("chunkRust AST — KJC-PCS-0052 PR-B.2.2", () => {
  beforeAll(async () => {
    await prepareRust();
  });

  it("captures impl_item using the implemented type as symbol", () => {
    const text = "struct Foo;\n\nimpl Foo {\n    fn new() -> Self { Foo }\n}\n\nimpl Display for Foo {\n    fn fmt(&self, f: &mut Formatter) -> Result { Ok(()) }\n}\n";
    const chunks = chunkRust(text, { path: "i.rs" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Foo", "Foo", "Foo"]);
    expect(chunks[1].text).toContain("impl Foo");
    expect(chunks[2].text).toContain("impl Display for Foo");
  });

  it("handles attributes and pub modifiers without splitting the symbol", () => {
    const text = "#[derive(Debug)]\npub struct Alpha {\n    pub x: i32,\n}\n\n#[inline]\npub async fn beta(x: i32) -> i32 { x + 1 }\n";
    const chunks = chunkRust(text, { path: "a.rs" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Alpha", "beta"]);
    expect(chunks[0].text).toContain("#[derive(Debug)]");
    expect(chunks[1].text).toContain("#[inline]");
  });
});
