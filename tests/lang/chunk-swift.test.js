// HU-4547 — Swift regex chunker: one chunk per top-level declaration.
import { describe, expect, it } from "vitest";

import { chunkSwift } from "../../src/lang/chunk-swift.js";

const SOURCE = `import Foundation

public final class Greeter {
    func hello() -> String { "hi" }
}

struct Point {
    var x: Int
}

enum Mode { case on, off }

protocol Runner { func run() }

extension Point: Equatable {}

@MainActor
actor Counter { var n = 0 }

func main() {
    print("go")
}
`;

describe("chunkSwift — HU-4547", () => {
  it("emits one chunk per top-level declaration, named after its symbol", () => {
    const chunks = chunkSwift(SOURCE, { path: "App.swift" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["Greeter", "Point", "Mode", "Runner", "Point", "Counter", "main"]);
    for (const c of chunks) {
      expect(c.metadata).toMatchObject({ source: "App.swift", kind: "code", language: "swift" });
      expect(c.metadata.start_line).toBeGreaterThan(0);
    }
    expect(chunks[0].text).toContain("func hello()");
  });

  it("does not split nested members into their own chunks", () => {
    const symbols = chunkSwift(SOURCE).map((c) => c.metadata.symbol);
    expect(symbols).not.toContain("hello");
  });

  it("falls back to window chunks when nothing matches", () => {
    const chunks = chunkSwift("let x = 1\n".repeat(200), { limit: 300, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.metadata.symbol === null)).toBe(true);
  });

  it("never throws on odd input", () => {
    expect(() => chunkSwift("")).not.toThrow();
    expect(() => chunkSwift(undefined)).not.toThrow();
    expect(() => chunkSwift("\u0000}}{{ class")).not.toThrow();
  });
});
