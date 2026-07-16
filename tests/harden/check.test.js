import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkCommand } from "../../src/commands/check.js";
import { hardenCommand } from "../../src/commands/harden.js";
import { checkHarden } from "../../src/harden/check.js";

let repo;
const logger = { info: vi.fn(), error: vi.fn() };
const harden = () => hardenCommand({ projectDir: repo, logger });

beforeEach(() => {
  vi.clearAllMocks();
  repo = mkdtempSync(join(tmpdir(), "kj-check-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("checkHarden", () => {
  it("passes on a freshly hardened repo", async () => {
    await harden();
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    expect(res.ok).toBe(true);
    expect(res.checks.find((c) => c.id === "config:.editorconfig").ok).toBe(true);
    expect(res.checks.find((c) => c.id === "workflow:kj-no-ai-attribution.yml").ok).toBe(true);
  });

  it("fails when the harness is absent", async () => {
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.id === "core.hooksPath").detail).toContain("run kj harden");
  });

  it("detects a deleted hook as drift", async () => {
    await harden();
    rmSync(join(repo, ".karajan", "hooks", "pre-push"));
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    expect(res.checks.find((c) => c.id === "hook:pre-push")).toMatchObject({ ok: false, detail: "missing" });
  });

  it("flags a hook that lost its kj marker", async () => {
    await harden();
    writeFileSync(join(repo, ".karajan", "hooks", "commit-msg"), "#!/usr/bin/env sh\necho hi\n");
    execFileSync("chmod", ["+x", join(repo, ".karajan", "hooks", "commit-msg")]);
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    expect(res.checks.find((c) => c.id === "hook:commit-msg")).toMatchObject({ ok: false, detail: "no kj marker" });
  });

  it("surfaces a newly added language whose config was never seeded (greenfield gap)", async () => {
    await harden(); // empty repo → only universal config
    writeFileSync(join(repo, "go.mod"), "module example.com/x\n");
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    expect(res.ok).toBe(false);
    const goCfg = res.checks.find((c) => c.id === "config:.golangci.yml");
    expect(goCfg).toMatchObject({ ok: false });
    expect(goCfg.detail).toContain("go");
  });
});

describe("checkCommand", () => {
  it("returns 0 and prints OK when clean", async () => {
    await harden();
    expect(await checkCommand({ projectDir: repo, logger })).toBe(0);
    expect(logger.info).toHaveBeenCalledWith("Harness OK.");
  });

  it("returns 1 on drift and emits JSON when asked", async () => {
    const code = await checkCommand({ projectDir: repo, json: true, logger });
    expect(code).toBe(1);
    expect(JSON.parse(logger.info.mock.calls.at(-1)[0]).ok).toBe(false);
  });

  it("does not flag eslint/prettier as drift when biome.json covers them (KJC-TSK-0614)", async () => {
    writeFileSync(join(repo, "package.json"), "{}");
    writeFileSync(join(repo, "biome.json"), "{}");
    await harden();
    const res = await checkHarden({ projectDir: repo, profile: "standard" });
    const covered = res.checks.filter((c) => c.detail?.startsWith("covered by biome.json"));
    expect(covered.length).toBeGreaterThanOrEqual(2); // eslint + prettier
    expect(covered.every((c) => c.ok)).toBe(true);
    expect(res.ok).toBe(true);
  });
});
