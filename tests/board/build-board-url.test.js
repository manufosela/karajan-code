import { describe, expect, it } from "vitest";
import { buildBoardUrl } from "../../src/commands/board.js";

// The HU Board frontend is a hash-routed SPA: opening a project
// pre-filtered means the deep-link must carry `#board/<slug>`, not a
// real path. `/p/<slug>` is not a router route — the SPA fallback serves
// index.html with no hash and the user lands on "All projects" instead.
// KJC-BUG-0093.
describe("buildBoardUrl", () => {
  it("deep-links a project via the hash route #board/<slug>", () => {
    expect(buildBoardUrl(4000, "home_aitor_git_transports_tracker")).toBe(
      "http://localhost:4000/#board/home_aitor_git_transports_tracker"
    );
  });

  it("never emits the broken /p/<slug> path route", () => {
    expect(buildBoardUrl(4321, "demo")).not.toMatch(/\/p\//);
  });

  it("returns the bare base URL when no project slug is given", () => {
    expect(buildBoardUrl(4000)).toBe("http://localhost:4000");
    expect(buildBoardUrl(4001, null)).toBe("http://localhost:4001");
  });
});
