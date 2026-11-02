import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0155: the method's pieces are characters of the orchestra, built on one
// frame (film/piece.js) with a body each that says what it does.
const read = (path) => readFileSync(new URL(`../../apps/landing/public/film/${path}`, import.meta.url), "utf8");
const BODIES = {
  tdd: "tddBody", sentinel: "sentinelBody", review: "reviewBody", gates: "gatesBody",
  sonar: "sonarBody", ledger: "ledgerBody", steward: "stewardBody",
};

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

// KJL-TSK-0156: the film casts the pieces, not crates, one body per slot.
describe("film cast", () => {
  const cast = read("cast.js");
  const score = read("score.js");

  it("stands one character per slot, in the order of the page's tools", () => {
    expect(cast).toContain("const BODIES = [tddBody, sentinelBody, reviewBody, gatesBody, sonarBody, ledgerBody, stewardBody];");
    expect(cast).toContain("createPiece(i, name, { kind, body: BODIES[i] })");
    expect(read("props.js")).not.toContain("createCrate");
  });

  it("passes the diff between raised hands, and lets AI review shake its head before the throw", () => {
    expect(score).toContain("piece.catch(");
    expect(score).toMatch(/pieces\[REFUSING_PIECE\]\.shake\(/);
  });
});
