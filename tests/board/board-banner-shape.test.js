import { describe, expect, it } from "vitest";
import { renderBoardBanner } from "../../src/commands/board.js";

// Strip ANSI escapes so we can measure the actual rendered width of a
// banner line.
const ANSI_RE = /\[[0-9;]*m/g;
const visible = (s) => s.replace(ANSI_RE, "");

describe("renderBoardBanner", () => {
  it("renders top + bottom rules of EQUAL length around the content", () => {
    const out = renderBoardBanner({
      url: "http://localhost:4000",
      status: "started",
      projectName: "Demo",
    });
    const lines = out.split("\n").filter(Boolean);
    // 1 top rule + 2 content lines (heading + project) + 1 bottom rule
    expect(lines.length).toBe(4);

    const ruleChar = "─";
    const isRule = (l) => visible(l).split("").every((c) => c === ruleChar);

    const topVisible = visible(lines[0]);
    const bottomVisible = visible(lines[lines.length - 1]);
    expect(isRule(lines[0])).toBe(true);
    expect(isRule(lines[lines.length - 1])).toBe(true);
    expect(topVisible.length).toBe(bottomVisible.length);
  });

  it("rules width matches the longest content line (or terminal width, whichever is smaller)", () => {
    const url = "http://localhost:4000/p/very-long-project-slug-that-might-exceed-old-50-char-box";
    const out = renderBoardBanner({ url, status: "started", projectName: "Demo" });
    const lines = out.split("\n").filter(Boolean);
    const maxContentWidth = Math.max(
      ...lines.slice(1, -1).map((l) => visible(l).length)
    );
    const ruleWidth = visible(lines[0]).length;
    const termWidth = (process.stdout.columns && process.stdout.columns > 20)
      ? process.stdout.columns
      : 100;
    // Either fits (rule >= content) or got capped at terminal width to
    // avoid a rule that wraps onto two lines.
    if (maxContentWidth + 2 <= termWidth) {
      expect(ruleWidth).toBeGreaterThanOrEqual(maxContentWidth);
      expect(ruleWidth).toBeLessThanOrEqual(maxContentWidth + 4);
    } else {
      expect(ruleWidth).toBe(termWidth);
    }
  });

  it("never draws a fixed-width 50-char box (the old broken layout)", () => {
    const out = renderBoardBanner({
      url: "http://localhost:4000/p/home_manu_ws_ai_linux-assistant-orchestrator",
      status: "started",
      projectName: "Linux Assistant Orchestrator",
    });
    expect(out).not.toMatch(/╭/);
    expect(out).not.toMatch(/╰/);
    expect(out).not.toMatch(/│/);
    expect(out).not.toMatch(/╮/);
    expect(out).not.toMatch(/╯/);
  });

  it("omits the project line when projectName is falsy", () => {
    const out = renderBoardBanner({ url: "http://x/", status: "started" });
    expect(out).not.toMatch(/Project:/);
  });

  it("includes both status and url visibly in the heading", () => {
    const out = renderBoardBanner({
      url: "http://localhost:4321/",
      status: "already running",
    });
    expect(visible(out)).toMatch(/HU Board · already running/);
    expect(visible(out)).toMatch(/http:\/\/localhost:4321\//);
  });
});
