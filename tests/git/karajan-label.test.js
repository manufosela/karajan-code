// KJC-TSK-1123 (#2315): every PR Karajan opens carries the «Karajan» label, created when
// the repo lacks it. It means "went through Karajan", never "written by an AI"; it lives
// only in the PR's metadata, and a failure to label is logged, never a lost PR.
import { describe, it, expect, vi } from "vitest";
import { labelKarajanPr, KARAJAN_LABEL } from "../../src/git/karajan-label.js";

const URL = "https://github.com/acme/app/pull/7";

describe("labelKarajanPr", () => {
  it("makes sure the label exists, then adds it to the PR", async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    expect(await labelKarajanPr({ url: URL, run, warn: vi.fn() })).toBe(true);
    expect(run.mock.calls[0][1].slice(0, 3)).toEqual(["label", "create", KARAJAN_LABEL]);
    expect(run.mock.calls[0][1]).toContain("--repo");
    expect(run.mock.calls[0][1]).toContain("acme/app");
    expect(run.mock.calls[1][1]).toEqual(["pr", "edit", URL, "--add-label", KARAJAN_LABEL]);
  });

  it("still labels when the label already exists (create fails, edit works)", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "already exists" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    const warn = vi.fn();
    expect(await labelKarajanPr({ url: URL, run, warn })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs and returns false when the PR cannot be labelled, never throws", async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 1, stdout: "", stderr: "HTTP 403" });
    const warn = vi.fn();
    expect(await labelKarajanPr({ url: URL, run, warn })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not add the Karajan label.*HTTP 403/));
    expect(await labelKarajanPr({ url: URL, run: vi.fn().mockRejectedValue(new Error("gh missing")), warn })).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/gh missing/));
  });
});
