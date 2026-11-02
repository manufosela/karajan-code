import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0155: the method's pieces are characters of the orchestra, built on one
// frame (film/piece.js) with a body each that says what it does.
const read = (path) => readFileSync(new URL(`../../apps/landing/public/film/${path}`, import.meta.url), "utf8");
const BODIES = { tdd: "tddBody", sentinel: "sentinelBody", review: "reviewBody" };

describe("film pieces", () => {
  const frame = read("piece.js");

  it("keeps the crates' light, and adds the hands that catch and the head that says no", () => {
    expect(frame).toContain("export function createPiece(index, name, { kind, body })");
    for (const api of ["setLight(gold, red = 0)", "catch(level)", "shake(amount, t)"]) expect(frame).toContain(api);
  });

  it("wears the family's face and arms, and the crates' plate and colours", () => {
    expect(frame).toContain("import { createArm, createFace, handWhite, metalIn } from './parts.js'");
    expect(frame).toContain("import { labelTexture, KINDS, RED } from './props.js'");
  });

  it.each(Object.entries(BODIES))("gives %s a body that places its face and shoulders", (file, name) => {
    const body = read(`pieces/${file}.js`);
    expect(body).toMatch(new RegExp(`export function ${name}\\(`));
    expect(body).toMatch(/return \{ group, face: \{ y: [\d.]+, z: -?[\d.]+, width: [\d.]+ \}, shoulders: \{ x: [\d.]+, y: [\d.]+, z: -?[\d.]+ \} \};/);
  });
});
