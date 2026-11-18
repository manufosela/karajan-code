// HU-4548 — PHP chunker: one chunk per top-level declaration (regex, no grammar).
import { describe, expect, it } from "vitest";

import { chunkPhp } from "../../src/lang/chunk-php.js";

describe("chunkPhp — HU-4548", () => {
  it("emits one chunk per top-level class/interface/trait/enum/function, named after the symbol", () => {
    const text = [
      "<?php",
      "namespace App;",
      "",
      "final class Alpha extends Base {",
      "    public function run() {}",
      "}",
      "interface Beta {}",
      "trait Gamma {}",
      "enum Delta: string { case A = 'a'; }",
      "abstract class Eps {}",
      "function helper($x) { return $x; }",
      "",
    ].join("\n");
    const chunks = chunkPhp(text, { path: "a.php" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Alpha", "Beta", "Gamma", "Delta", "Eps", "helper"]);
    expect(chunks[0].text).toContain("class Alpha");
    expect(chunks[0].text).toContain("public function run");
    for (const c of chunks) {
      expect(c.metadata.language).toBe("php");
      expect(c.metadata.kind).toBe("code");
      expect(c.metadata.source).toBe("a.php");
    }
  });

  it("falls back to window chunks when nothing matches, and never throws", () => {
    const chunks = chunkPhp("<?php\n$x = 1;\n", { path: "s.php" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbol).toBeNull();
    expect(chunkPhp("", { path: "e.php" })).toBeTruthy();
    expect(() => chunkPhp(undefined)).not.toThrow();
    expect(() => chunkPhp(null)).not.toThrow();
    expect(() => chunkPhp(42)).not.toThrow();
  });
});
