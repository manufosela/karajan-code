import { describe, expect, it } from "vitest";
import { sources } from "../apps/landing/docs/scripts/family-docs.config.mjs";

describe("family-docs sources", () => {
  it("pins the atril source to the rebased readme commit", () => {
    const atril = sources.find((source) => source.path === "packages/atril/README.md");
    expect(atril?.ref).toBe("1f93ff844b77afbffd1f2683c35ff657f103286d");
  });
});
