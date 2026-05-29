// KJC-PCS-0052 PR-B — Python chunker. Cubre las dos primeras acceptance
// criteria del card (top-level def/class → chunks con symbol; fallback
// windowing cuando no hay markers) y verifica el dispatch desde el
// chunker general por adapter.
import { describe, expect, it } from "vitest";

import { chunkPython } from "../../src/lang/chunk-python.js";
import { chunkSource } from "../../src/rag/chunker.js";

describe("chunkPython — KJC-PCS-0052 PR-B", () => {
  it("emits one chunk per top-level def/class with metadata.symbol", () => {
    const text = "def alpha():\n    return 1\n\nclass Beta:\n    pass\n\nasync def gamma():\n    return 3\n";
    const chunks = chunkPython(text, { path: "x.py" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["alpha", "Beta", "gamma"]);
    expect(chunks[0].text).toContain("def alpha()");
    expect(chunks[1].text).toContain("class Beta");
    expect(chunks[2].text).toContain("async def gamma");
    for (const c of chunks) {
      expect(c.metadata.language).toBe("python");
      expect(c.metadata.kind).toBe("code");
      expect(c.metadata.source).toBe("x.py");
    }
  });

  it("does NOT pick up nested methods — indented def stays inside the parent class chunk", () => {
    const text = "class Foo:\n    def method(self):\n        return 1\n\ndef top():\n    return 2\n";
    const chunks = chunkPython(text, { path: "x.py" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Foo", "top"]);
    expect(chunks[0].text).toContain("def method(self)");
  });

  it("falls back to windowText when no top-level markers exist (script-only)", () => {
    const text = "# just a script\nprint('hi')\n";
    const chunks = chunkPython(text, { path: "s.py" });
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe(null);
    expect(chunks[0].metadata.language).toBe("python");
  });

  it("windows oversized bodies (limit boundary)", () => {
    const body = "x" + "y".repeat(2000);
    const text = `def huge():\n    return "${body}"\n`;
    const chunks = chunkPython(text, { path: "h.py", limit: 200, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.metadata.symbol).toBe("huge");
  });
});

describe("chunkSource adapter dispatch — KJC-PCS-0052 PR-B", () => {
  it("routes .py files through chunkPython (symbol metadata present)", () => {
    const text = "def alpha():\n    return 1\n\ndef beta():\n    return 2\n";
    const chunks = chunkSource(text, { path: "/tmp/x.py" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["alpha", "beta"]);
    expect(chunks[0].metadata.language).toBe("python");
  });

  it("keeps .js files on the JS path (no language tag, JS regex/AST decides symbol)", () => {
    const text = "export function alpha() { return 1; }\n";
    const chunks = chunkSource(text, { path: "/tmp/x.js" });
    expect(chunks[0].metadata.symbol).toBe("alpha");
    expect(chunks[0].metadata.language).toBeUndefined();
  });
});
