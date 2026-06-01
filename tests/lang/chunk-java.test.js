// KJC-PCS-0052 PR-B.2.5 — Java chunker (regex + AST tests + chunkSource routing).

import { beforeAll, describe, expect, it } from "vitest";

import { chunkJava, prepareJava } from "../../src/lang/chunk-java.js";
import { chunkSource } from "../../src/rag/chunker.js";

describe("chunkJava — KJC-PCS-0052 PR-B.2.5", () => {
  it("emits one chunk per top-level class/interface/enum with metadata.symbol (regex fallback)", () => {
    const text = "public class Alpha {}\n\ninterface Beta {}\n\npublic enum Gamma { A, B }\n";
    const chunks = chunkJava(text, { path: "x.java" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(chunks[0].text).toContain("class Alpha");
    expect(chunks[1].text).toContain("interface Beta");
    expect(chunks[2].text).toContain("enum Gamma");
    for (const c of chunks) {
      expect(c.metadata.language).toBe("java");
      expect(c.metadata.kind).toBe("code");
      expect(c.metadata.source).toBe("x.java");
    }
  });

  it("captures record top-level (Java 14+) via regex", () => {
    const text = "public record Point(int x, int y) {}\n";
    const chunks = chunkJava(text, { path: "p.java" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbol).toBe("Point");
  });

  it("falls back to windowText when no top-level items exist", () => {
    const text = "// just a comment\nimport java.util.List;\n";
    const chunks = chunkJava(text, { path: "s.java" });
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe(null);
    expect(chunks[0].metadata.language).toBe("java");
  });

  it("windows oversized bodies (limit boundary)", () => {
    const body = "x".repeat(2000);
    const text = `public class Huge {\n    String s = "${body}";\n}\n`;
    const chunks = chunkJava(text, { path: "h.java", limit: 200, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.metadata.symbol).toBe("Huge");
  });
});

describe("chunkSource adapter dispatch — Java", () => {
  it("routes .java files through chunkJava (symbol metadata present, language=java)", () => {
    const text = "public class Alpha {}\n\nclass Beta {}\n";
    const chunks = chunkSource(text, { path: "/tmp/x.java" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Alpha", "Beta"]);
    expect(chunks[0].metadata.language).toBe("java");
  });
});

describe("chunkJava AST — KJC-PCS-0052 PR-B.2.5", () => {
  beforeAll(async () => {
    await prepareJava();
  });

  it("walks class body and captures method_declaration with method name as symbol", () => {
    const text = "public class Foo {\n    public int bar() { return 1; }\n    public String baz() { return \"x\"; }\n}\n";
    const chunks = chunkJava(text, { path: "i.java" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Foo", "bar", "baz"]);
    expect(chunks[1].text).toContain("int bar()");
    expect(chunks[2].text).toContain("String baz()");
  });

  it("captures constructor_declaration and record_declaration members", () => {
    const text = "public class Foo {\n    public Foo() {}\n    void m() {}\n}\n";
    const chunks = chunkJava(text, { path: "c.java" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Foo", "Foo", "m"]);
    const rec = chunkJava("public record P(int x) {}\n", { path: "r.java" });
    expect(rec[0].metadata.symbol).toBe("P");
  });
});
