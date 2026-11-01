import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fitBeside } from "../../apps/landing/public/film/framing.js";

// KJL-BUG-0007: the hero stacks the copy over the film on narrow or near-square
// screens, and the film frames its final shot for that layout. The CSS and the
// film must agree on when that happens, or the cast lands under the copy.
const read = (path) => readFileSync(new URL(`../../apps/landing/public/${path}`, import.meta.url), "utf8");
const css = read("css/landing.css");
const film = read("film/main.js");

describe("hero layout", () => {
  it("uses the same media query in the CSS and in the film", () => {
    const filmQuery = film.match(/const stacked = matchMedia\('([^']+)'\)/)?.[1];
    expect(filmQuery).toBeTruthy();
    expect(css).toContain(`@media ${filmQuery} {`);
  });

  it("frames the final shot from where the copy ends, not from a fixed share of the screen", () => {
    expect(film).toContain("beside.shift * aside");
    expect(film).toContain("copyBottom * aside");
  });
});

// KJL-BUG-0008: a fixed guess of the cast's width fell short on wide, low windows
// (1887x890, 1280x640) and the first crates slid under the prompt box. The film now
// measures the cast on screen and fits that span into the room right of the copy.
describe("fitBeside", () => {
  const screen = { width: 1887, copyRight: 810, gap: 40 };
  const after = ({ left, right }, { wide, shift }) => {
    const cx = screen.width / 2;
    return { left: cx + (left - cx) / wide - shift, right: cx + (right - cx) / wide - shift };
  };

  it("pulls back until the cast fits the room, and slides it clear of the copy", () => {
    const cast = { left: 640, right: 1740 };
    const frame = fitBeside(cast, screen);
    expect(frame.wide).toBeGreaterThan(1);
    const seen = after(cast, frame);
    expect(seen.left).toBeCloseTo(screen.copyRight + screen.gap);
    expect(seen.right).toBeCloseTo(screen.width - screen.gap);
  });

  it("only slides a cast that already fits, centring it in the room", () => {
    const cast = { left: 700, right: 1300 };
    const frame = fitBeside(cast, screen);
    expect(frame.wide).toBe(1);
    const seen = after(cast, frame);
    expect((seen.left + seen.right) / 2).toBeCloseTo((screen.copyRight + screen.width) / 2);
  });
});
