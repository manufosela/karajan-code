import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkCommand } from "../../src/commands/check.js";
import { checkHarden } from "../../src/harden/check.js";
import { installHooks } from "../../src/harden/harden-engine.js";

let repo;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-check-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("checkHarden", () => {
  it("passes on a freshly hardened repo", async () => {
    await installHooks({ projectDir: repo, profile: "standard" });
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    expect(res.ok).toBe(true);
    expect(res.checks.find((c) => c.id === "core.hooksPath").ok).toBe(true);
  });

  it("fails when the harness is absent", async () => {
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.id === "core.hooksPath").detail).toContain("run kj harden");
  });

  it("detects a deleted hook as drift", async () => {
    await installHooks({ projectDir: repo, profile: "standard" });
    rmSync(join(repo, ".karajan", "hooks", "pre-push"));
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.id === "hook:pre-push")).toMatchObject({ ok: false, detail: "missing" });
  });

  it("flags a hook that lost its kj marker", async () => {
    await installHooks({ projectDir: repo, profile: "standard" });
    writeFileSync(join(repo, ".karajan", "hooks", "commit-msg"), "#!/usr/bin/env sh\necho hi\n");
    execFileSync("chmod", ["+x", join(repo, ".karajan", "hooks", "commit-msg")]);
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    expect(res.checks.find((c) => c.id === "hook:commit-msg")).toMatchObject({ ok: false, detail: "no kj marker" });
  });
});

describe("checkCommand", () => {
  it("returns 0 and prints OK when clean", async () => {
    await installHooks({ projectDir: repo, profile: "standard" });
    const logger = { info: vi.fn() };
    expect(await checkCommand({ projectDir: repo, logger })).toBe(0);
    expect(logger.info).toHaveBeenCalledWith("Harness OK.");
  });

  it("returns 1 on drift and emits JSON when asked", async () => {
    const logger = { info: vi.fn() };
    const code = await checkCommand({ projectDir: repo, json: true, logger });
    expect(code).toBe(1);
    expect(JSON.parse(logger.info.mock.calls.at(-1)[0]).ok).toBe(false);
  });
});
