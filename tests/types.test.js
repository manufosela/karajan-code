import { describe, expect, it } from "vitest";

/**
 * Typedef modules are runtime-empty — they only carry JSDoc annotations.
 * This test verifies that they load without syntax errors so an accidental
 * typo in the JSDoc comment block doesn't crash consumers.
 */

describe("src/types/ — JSDoc typedef modules load cleanly", () => {
  const modules = [
    "../src/types/index.js",
    "../src/types/config.js",
    "../src/types/session.js",
    "../src/types/stage.js",
    "../src/types/agent.js",
    "../src/types/hu.js",
    "../src/types/policy.js",
  ];

  for (const specifier of modules) {
    it(`imports ${specifier} without error`, async () => {
      const mod = await import(specifier);
      // Every file exports an empty {} — just verify it's an object namespace.
      expect(mod).toBeTypeOf("object");
    });
  }
});
