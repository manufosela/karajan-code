import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { holdBoardInstall } from "../src/server.js";
import { installRoot } from "../../../src/utils/install-lease.js";

// KJC-BUG-0534: the cron that rotates the stable kj deletes a retired copy
// unless a live server left its pid in .kj-running/. Only the MCP server did;
// the board kept serving from a deleted copy and every page gave 404.

describe("holdBoardInstall — the board declares the kj copy it runs from", () => {
  it("holds the install lease under the name hu-board", () => {
    const calls = [];
    holdBoardInstall((opts) => calls.push(opts));
    expect(calls).toEqual([{ name: "hu-board" }]);
  });

  it("the lease's default root is the kj copy that ships the board", () => {
    expect(existsSync(join(installRoot(), "packages/hu-board/src/server.js"))).toBe(true);
  });
});
