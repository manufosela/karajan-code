import { describe, expect, it } from "vitest";

import { chunkKotlin } from "../../src/lang/chunk-kotlin.js";
import { KOTLIN_ADAPTER } from "../../src/lang/kotlin.js";

const SRC = `package demo

import kotlin.math.abs

data class User(val id: Int)

sealed class Shape {
    class Circle(val r: Int) : Shape()
}

enum class Color { RED, GREEN }

object Registry {
    fun nested() = 1
}

interface Greeter { fun greet(): String }

internal fun <T> List<T>.second(): T = this[1]

fun main() {
    println("hi")
}
`;

describe("chunkKotlin — HU-4546", () => {
  it("emits one chunk per top-level declaration, named after the symbol", () => {
    const chunks = chunkKotlin(SRC, { path: "A.kt" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(
      expect.arrayContaining(["User", "Shape", "Color", "Registry", "Greeter", "second", "main"]),
    );
    expect(chunks.map((c) => c.metadata.symbol).filter(Boolean)).toHaveLength(7);
    expect(chunks.find((c) => c.metadata.symbol === "Registry").text).toContain("fun nested");
    expect(chunks[0].metadata).toMatchObject({ source: "A.kt", kind: "code", language: "kotlin" });
  });

  it("falls back to window chunks when nothing matches", () => {
    const chunks = chunkKotlin("val x = 1\n".repeat(300), { path: "s.kts", limit: 200, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.metadata.symbol === null)).toBe(true);
  });

  it("never throws on odd input", () => {
    expect(() => chunkKotlin("")).not.toThrow();
    expect(() => chunkKotlin(undefined)).not.toThrow();
    expect(() => chunkKotlin(null)).not.toThrow();
  });

  it("adapter declares kotlin extensions, skips and manifests", () => {
    expect(KOTLIN_ADAPTER).toMatchObject({
      id: "kotlin",
      extensions: [".kt", ".kts"],
      skipSegments: [".gradle", ".kotlin"],
      manifests: ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
      chunkSource: chunkKotlin,
    });
  });
});
