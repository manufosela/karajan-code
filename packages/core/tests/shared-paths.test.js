// Smoke coverage for the @karajan/core/shared-paths extraction
// (KJC-TSK-0511 PR2). Full unit coverage stays next to the CLI;
// this file proves the new package entry point resolves and returns
// stable paths so a future workspace-wiring regression fails loudly.
import { sep } from "node:path";
import { describe, it, expect } from "vitest";

import {
  SHARED_DIR_NAME,
  getSharedRoot,
  getSharedPlansDir,
  getSharedHuStoriesDir,
  isSharedPath,
} from "../src/shared-paths.js";

describe("@karajan/core/shared-paths", () => {
  it("constants and joins land inside the project dir", () => {
    expect(SHARED_DIR_NAME).toBe(".karajan-shared");
    expect(getSharedRoot("/tmp/proj")).toBe(`/tmp/proj${sep}.karajan-shared`);
    expect(getSharedPlansDir("/tmp/proj").endsWith(`${sep}plans`)).toBe(true);
    expect(getSharedHuStoriesDir("/tmp/proj").endsWith(`${sep}hu-stories`)).toBe(true);
  });

  it("isSharedPath recognises only paths within .karajan-shared", () => {
    expect(isSharedPath("/repo/.karajan-shared/plans/x.json")).toBe(true);
    expect(isSharedPath("/repo/local/plans/x.json")).toBe(false);
    expect(isSharedPath("")).toBe(false);
    expect(isSharedPath(null)).toBe(false);
  });
});
