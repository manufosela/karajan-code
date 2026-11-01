import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-BUG-0006: the verdict's wave ends at opacity 0 but stayed in the depth
// buffer, so its invisible ring hid part of the Ledger crate's label in the
// final shot. An effect that fades to nothing must not write depth.
const props = readFileSync(new URL("../../apps/landing/public/film/props.js", import.meta.url), "utf8");
const stand = readFileSync(new URL("../../apps/landing/public/film/stand.js", import.meta.url), "utf8");

describe("film props", () => {
  it("lets every effect that starts invisible stay out of the depth buffer", () => {
    const fading = [...props.matchAll(/new THREE\.MeshBasicMaterial\(\{[^}]*opacity: 0[^}]*\}\)/g)].map(([m]) => m);
    expect(fading.length).toBeGreaterThan(0);
    for (const material of fading) expect(material).toContain("depthWrite: false");
  });

  // KJL-TSK-0150: atril joins the family: glowing eyes that blink and follow the
  // diff, an arm that turns the pages, both arms up on the verdict, a plate that reads.
  it("brings atril to life every frame", () => {
    const score = readFileSync(new URL("../../apps/landing/public/film/score.js", import.meta.url), "utf8");
    expect(stand).toMatch(/live\(blink, look, cheer\)/);
    expect(stand).toContain("function createFace");
    expect(stand).toContain("function createArm");
    expect(score).toMatch(/cast\.stand\.live\(blinkAt\(t, [\d.]+\), look, pulse\(t, T\.verdict/);
  });

  it("keeps atril's stand out of the shadow map, where its thin poles band the whole stage", () => {
    expect(stand).toContain("export function createStand");
    expect(stand).not.toMatch(/castShadow\s*=\s*true/);
  });
});
