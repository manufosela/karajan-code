// KJC-TSK-0712 — memory is the reminder; the check is the guarantee.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runReleaseCheck } from "../../src/checks/release-check.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
const write = (rel, text) => fs.writeFileSync(path.join(dir, rel), text);
const byName = (res, name) => res.checks.find((c) => c.name === name);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-relcheck-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  write("package.json", JSON.stringify({ name: "demo", version: "1.2.0", private: true }));
  write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-08-03\n\n- stuff\n\n## [1.1.0] - 2026-08-01\n");
  write("a.txt", "x"); git("add", "-A"); git("commit", "-qm", "base");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("runReleaseCheck — generics", () => {
  it("passes when manifest, top CHANGELOG section and tags agree", async () => {
    const res = await runReleaseCheck({ projectDir: dir, config: {} });
    expect(res.ok).toBe(true);
    expect(byName(res, "changelog-current").ok).toBe(true);
  });

  it("fails RED when the CHANGELOG top section is not the manifest version", async () => {
    write("package.json", JSON.stringify({ name: "demo", version: "1.3.0", private: true }));
    const res = await runReleaseCheck({ projectDir: dir, config: {} });
    expect(res.ok).toBe(false);
    const c = byName(res, "changelog-current");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("1.3.0");
  });

  it("fails when [Unreleased] still carries unpromoted content", async () => {
    write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- forgotten entry\n\n## [1.2.0] - 2026-08-03\n\n- stuff\n");
    const res = await runReleaseCheck({ projectDir: dir, config: {} });
    expect(byName(res, "changelog-current").ok).toBe(false);
    expect(byName(res, "changelog-current").detail).toMatch(/Unreleased/);
  });

  it("fails when a tag AHEAD of the manifest exists; same-version tag is only info", async () => {
    git("tag", "v1.2.0");
    expect((await runReleaseCheck({ projectDir: dir, config: {} })).ok).toBe(true);
    git("tag", "v1.4.0");
    const res = await runReleaseCheck({ projectDir: dir, config: {} });
    expect(res.ok).toBe(false);
    expect(byName(res, "tags").detail).toContain("1.4.0");
  });
});

describe("runReleaseCheck — declared items", () => {
  it("file_contains interpolates {version}; command passes on exit 0 and fails otherwise", async () => {
    write("footer.html", "<span>v1.2.0</span>");
    const config = { release_check: { items: [
      { name: "footer shows version", file_contains: { path: "footer.html", pattern: "v{version}" } },
      { name: "always ok", command: "true" },
      { name: "always fails", command: "false" },
      { name: "ghost", file_contains: { path: "nope.txt", pattern: "x" } }, // missing file = red, not crash
    ] } };
    const res = await runReleaseCheck({ projectDir: dir, config });
    expect(byName(res, "footer shows version").ok).toBe(true);
    expect(byName(res, "always ok").ok).toBe(true);
    expect(byName(res, "always fails").ok).toBe(false);
    expect(byName(res, "ghost").ok).toBe(false);
    expect(res.ok).toBe(false);
  });
});
