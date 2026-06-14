import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hardenCommand } from "../../src/commands/harden.js";
import { installHooks } from "../../src/harden/harden-engine.js";
import { hookBody } from "../../src/harden/hook-templates.js";

let repo;
const logger = { info: vi.fn(), error: vi.fn() };
const hook = (name) => readFileSync(join(repo, ".karajan", "hooks", name), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  repo = mkdtempSync(join(tmpdir(), "kj-native-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("hookBody is pure POSIX (no Node imposed)", () => {
  it("commit-msg checks Conventional Commits, length and AI attribution without npx", () => {
    const body = hookBody("commit-msg");
    expect(body).not.toContain("npx");
    expect(body).toContain("feat|fix|docs");
    expect(body).toContain("exceeds 100 chars");
    expect(body).toContain("AI attribution");
  });

  it("omits lint/test lines when no native command is available", () => {
    expect(hookBody("pre-commit")).toContain("no lint/format command detected");
    expect(hookBody("pre-push")).toContain("no test command detected");
  });

  it("inlines the native command it is given", () => {
    expect(hookBody("pre-commit", { lint: "go vet ./..." })).toContain("go vet ./...");
  });

  it("pre-push refuses to push without a configured git identity", () => {
    const body = hookBody("pre-push");
    expect(body).toContain("user.email");
    expect(body).toContain("refusing to push");
    expect(body).toContain("pushing as");
  });

  it("generates hooks that are valid POSIX shell (sh -n)", async () => {
    writeFileSync(join(repo, "go.mod"), "module example.com/x\n");
    await installHooks({ projectDir: repo, profile: "standard", cmds: { lint: "go vet ./...", test: "go test ./..." } });
    for (const name of ["pre-commit", "commit-msg", "pre-push", "post-merge"]) {
      expect(() => execFileSync("sh", ["-n", join(repo, ".karajan", "hooks", name)])).not.toThrow();
    }
  });
});

describe("kj harden uses native commands per language, never npm by default", () => {
  it("a Go repo gets go tooling and no npm", async () => {
    writeFileSync(join(repo, "go.mod"), "module example.com/x\n");
    await hardenCommand({ projectDir: repo, logger });
    expect(hook("pre-commit")).toContain("go vet ./...");
    expect(hook("pre-push")).toContain("go test ./...");
    expect(hook("pre-commit")).not.toContain("npm");
  });

  it("a Python repo gets ruff and pytest", async () => {
    writeFileSync(join(repo, "pyproject.toml"), "[project]\nname = 'x'\n");
    await hardenCommand({ projectDir: repo, logger });
    expect(hook("pre-commit")).toContain("ruff check .");
    expect(hook("pre-push")).toContain("pytest");
    expect(hook("pre-commit")).not.toContain("npm");
  });

  it("a PHP repo gets phpstan/php-cs-fixer/phpunit, no npm", async () => {
    writeFileSync(join(repo, "composer.json"), "{}");
    await hardenCommand({ projectDir: repo, logger });
    expect(hook("pre-commit")).toContain("vendor/bin/phpstan analyse");
    expect(hook("pre-push")).toContain("vendor/bin/phpunit");
    expect(hook("pre-commit")).not.toContain("npm");
  });

  it("an unknown stack gets only universal checks (no tooling, no Node)", async () => {
    writeFileSync(join(repo, "README.md"), "# x\n");
    await hardenCommand({ projectDir: repo, logger });
    expect(hook("pre-commit")).toContain("no lint/format command detected");
    expect(hook("pre-push")).toContain("no test command detected");
    expect(hook("commit-msg")).not.toContain("npx");
  });
});
