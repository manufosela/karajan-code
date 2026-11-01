import { describe, expect, it } from "vitest";
import { T, SLOTS, REFUSING_CRATE, span, hops, asideAt } from "../../apps/landing/public/film/timeline.js";

// KJL-TSK-0146: the hero film is a pure function of its clock. These guards keep
// the story in order and the travelling diff landing where the camera expects it.
describe("landing film timeline", () => {
  it("tells the story in order", () => {
    const beats = [T.rogueDrop, T.rogueHops, T.refuse, T.rogueGone, T.honestDrop, T.honestHops, T.verdict, T.outro, T.titles, T.end];
    expect(beats).toEqual(beats.toSorted((a, b) => a - b));
  });

  it("earns the verdict when the reviewed diff lands on the pedestal, after every crate", () => {
    expect(T.verdict).toBeCloseTo(T.honestHops + (SLOTS.length + 1) * T.honestHop);
  });

  it("refuses the unreviewed diff in mid-air, on its hop onto the AI review crate", () => {
    expect(T.refuse).toBeLessThan(T.rogueHops + (REFUSING_CRATE + 1) * T.rogueHop);
    expect(T.refuse).toBeGreaterThan(T.rogueHops + REFUSING_CRATE * T.rogueHop);
  });

  // atril is new in 5.0 and opens the line: eight crates, AI review the fourth.
  it("lines up eight crates, left to right, with AI review fourth", () => {
    expect(SLOTS).toHaveLength(8);
    expect(SLOTS).toEqual(SLOTS.toSorted((a, b) => a - b));
    expect(REFUSING_CRATE).toBe(3);
  });

  it("earns the verdict before the closing shot begins", () => {
    expect(T.verdict + 0.5).toBeLessThan(T.outro);
  });

  it("clamps progress between 0 and 1", () => {
    expect(span(0, 1, 2)).toBe(0);
    expect(span(1.5, 1, 2)).toBe(0.5);
    expect(span(3, 1, 2)).toBe(1);
  });

  describe("hops", () => {
    const points = [[0, 0], [1, 1], [2, 1]];

    it("lands each hop on its point, upright after whole turns", () => {
      for (const [i, [x, y]] of points.entries()) {
        const h = hops(points, 0, 1, i);
        expect(h.x).toBeCloseTo(x);
        expect(h.y).toBeCloseTo(y);
        expect((h.spin / (2 * Math.PI)) % 1).toBeCloseTo(0);
      }
    });

    it("arcs above both ends mid-hop", () => {
      expect(hops(points, 0, 1, 0.5).y).toBeGreaterThan(1);
    });

    it("stays on the last point once landed", () => {
      const h = hops(points, 0, 1, 9);
      expect(h.landed).toBe(true);
      expect(h.x).toBe(2);
    });
  });

  it("slides the final frame aside only in the outro", () => {
    expect(asideAt(T.outro - 1)).toBe(0);
    expect(asideAt(T.outro + 1)).toBeGreaterThan(0);
    expect(asideAt(T.end)).toBe(1);
  });
});
