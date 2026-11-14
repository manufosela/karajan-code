// HU-4285 (#4166): kj hu adopt is for the GitHub Issues board; it adopts through the manager and
// refreshes the mirror the gates read.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-hu-adopt-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const adopt = (args, deps) => huCommand({ config: { projectDir: dir }, action: "adopt", args, flags: { json: true }, deps });

describe("kj hu adopt", () => {
  it("says adopt is for GitHub Issues boards on any other backend", async () => {
    await expect(adopt(["187"], { boardConfig: async () => ({ backend: "local" }) })).rejects.toThrow(/for GitHub Issues boards/);
  });

  it("adopts the issue through the manager and refreshes the mirror", async () => {
    const card = { short_id: "HU-187", number: 187, title: "Headings", status: "pending", claimed_by: null, ref: null, tier: null };
    const adoptIssue = vi.fn(async () => card);
    const writeMirror = vi.fn(async () => {});
    const manager = { idHint: "HU-<n>", capabilities: {}, list: async () => [card], adopt: adoptIssue };
    const deps = { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), manager, writeMirror, pinGhIdentity: () => {}, who: "me" };
    expect(await adopt(["187"], deps)).toMatchObject({ short_id: "HU-187", repo: "acme/app" });
    expect(adoptIssue).toHaveBeenCalledWith(187);
    expect(writeMirror).toHaveBeenCalledWith(dir, [card], expect.objectContaining({ repo: "acme/app" }));
    await expect(adopt(["abc"], deps)).rejects.toThrow(/usage: kj hu adopt/);
  });
});
