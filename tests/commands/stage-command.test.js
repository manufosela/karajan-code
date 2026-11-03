import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stageCommand, stagePath } from "../../src/commands/stage.js";
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

  it("the board project bar links to the stage of the loaded project", () => {
    const board = join(import.meta.dirname, "..", "..", "packages", "hu-board", "public");
    expect(readFileSync(join(board, "index.html"), "utf8")).toContain('id="project-nav-stage"');
    expect(readFileSync(join(board, "app.js"), "utf8")).toMatch(/project-nav-stage'\)\.href = `\/stage\.html\?project=\$\{encodeURIComponent\(selectedProject\)\}`/);
  });
});
