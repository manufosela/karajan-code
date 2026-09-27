import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { boardSlug, buildBoardUrl } from "../../src/commands/board.js";
import { projectSlug } from "../../src/plan/plan-store.js";

// KJC-TSK-0884 (ADR 0011, board scoped): kj opens the project's scoped view
// `/p/<slug>`: one project, the multi-project affordances hidden. Checked in a
// browser on 28-sep: the SPA fallback serves it and app.js boots scoped-mode.
// KJC-BUG-0093's `#board/<slug>` kept the global dashboard around the project.
describe("buildBoardUrl", () => {
  it("opens the project's scoped view /p/<slug>", () => {
    expect(buildBoardUrl(4000, "home_aitor_git_transports_tracker")).toBe(
      "http://localhost:4000/p/home_aitor_git_transports_tracker"
    );
  });

  it("never lands on the multi-project dashboard with a project in hand", () => {
    expect(buildBoardUrl(4321, "demo")).not.toMatch(/#board\//);
  });

  it("a kj worktree lane opens the parent repo's view, not an empty one", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "kj-board-slug-")));
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
    try {
      git(repo, "init", "-q");
      git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
      git(repo, "worktree", "add", "-q", join(repo, "lane"));
      expect(boardSlug(join(repo, "lane"))).toBe(projectSlug(repo));
      expect(boardSlug(repo)).toBe(projectSlug(repo));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("returns the bare base URL when no project slug is given", () => {
    expect(buildBoardUrl(4000)).toBe("http://localhost:4000");
    expect(buildBoardUrl(4001, null)).toBe("http://localhost:4001");
  });
});
