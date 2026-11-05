import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stageCommand, stagePath } from "../../src/commands/stage.js";
import { boardRefusal } from "../../src/commands/board.js";
import { projectSlug } from "../../src/plan/plan-store.js";

// KJC-TSK-1400 (ADR 0046): kj stage opens the live stage of the project it runs in.
describe("kj stage", () => {
  let repo;
  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "kj-stage-cmd-")));
    execFileSync("git", ["init", "-q"], { cwd: repo });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("points at the stage page of the project, by its board slug", () => {
    expect(stagePath(repo)).toBe(`/stage.html?project=${encodeURIComponent(projectSlug(repo))}`);
  });

  it("opens that page through the board, which starts itself when it is not running", async () => {
    const calls = [];
    const open = async (args) => { calls.push(args); return { ok: true }; };
    await stageCommand({ projectDir: repo, port: 4321, logger: {}, open });
    expect(calls).toEqual([{ action: "open", port: 4321, logger: {}, path: stagePath(repo) }]);
  });

  describe("keeps the board's own safeguards", () => {
    const opened = async (config, force) => {
      const calls = [];
      const open = async (args) => { calls.push(args); return { ok: true }; };
      const result = await stageCommand({ projectDir: repo, port: 4321, logger: {}, config, force, open });
      return { calls, result };
    };

    it("never starts a parallel board when the project's board is external", async () => {
      const { calls, result } = await opened({ state_backend: "external", board: { name: "Linear" } }, true);
      expect(calls).toEqual([]);
      expect(result).toMatchObject({ ok: false, refusal: { level: "warn" } });
      expect(result.refusal.message).toContain("Linear (state_backend: external)");
    });

    it("does not start a board the config disables, unless forced", async () => {
      const off = { hu_board: { enabled: false } };
      const refused = await opened(off, false);
      expect(refused.calls).toEqual([]);
      expect(refused.result.refusal).toMatchObject({ level: "error" });
      expect(refused.result.refusal.message).toContain("kj stage --force");
      expect((await opened(off, true)).calls).toHaveLength(1);
    });

    it("the shared rule never refuses stop, so a leftover board can be cleaned up", () => {
      expect(boardRefusal({ state_backend: "external" }, { action: "stop" })).toBeNull();
      expect(boardRefusal({ state_backend: "external" }, { action: "status" })).toMatchObject({ level: "warn" });
    });
  });

  it("the board project bar links to the stage of the loaded project", () => {
    const board = join(import.meta.dirname, "..", "..", "packages", "hu-board", "public");
    expect(readFileSync(join(board, "index.html"), "utf8")).toContain('id="project-nav-stage"');
    expect(readFileSync(join(board, "app.js"), "utf8")).toMatch(/project-nav-stage'\)\.href = `\/stage\.html\?project=\$\{encodeURIComponent\(selectedProject\)\}`/);
  });
});
