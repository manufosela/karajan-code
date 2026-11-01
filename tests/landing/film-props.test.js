import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-BUG-0006: the verdict's wave ends at opacity 0 but stayed in the depth
// buffer, so its invisible ring hid part of the Ledger crate's label in the
// final shot. An effect that fades to nothing must not write depth.
const props = readFileSync(new URL("../../apps/landing/public/film/props.js", import.meta.url), "utf8");

describe("film props", () => {
  it("lets every effect that starts invisible stay out of the depth buffer", () => {
    const fading = [...props.matchAll(/new THREE\.MeshBasicMaterial\(\{[^}]*opacity: 0[^}]*\}\)/g)].map(([m]) => m);
    expect(fading.length).toBeGreaterThan(0);
    for (const material of fading) expect(material).toContain("depthWrite: false");
  });
});
