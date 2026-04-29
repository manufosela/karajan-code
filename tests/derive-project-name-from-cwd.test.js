/**
 * Unit tests for the cwd-based project-name resolver.
 *
 * The resolver tries package.json → git remote → directory basename
 * before falling back to null (caller then uses task-text heuristic).
 * We drive each signal in isolation through the __test__ exports plus
 * one end-to-end happy path on a real tmp directory.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

import { deriveProjectNameFromCwd, __test__ } from "../src/utils/derive-project-name-from-cwd.js";

const { prettifyName, readPackageJsonName, readGitRemoteBasename, readCwdBasename } = __test__;

describe("prettifyName", () => {
  it("turns kebab-case into Title Case", () => {
    expect(prettifyName("weather-dashboard")).toBe("Weather Dashboard");
  });
  it("turns snake_case into Title Case", () => {
    expect(prettifyName("weather_dashboard")).toBe("Weather Dashboard");
  });
  it("splits camelCase boundaries", () => {
    expect(prettifyName("WeatherDashboard")).toBe("Weather Dashboard");
  });
  it("preserves single Title-cased token", () => {
    expect(prettifyName("Karajan")).toBe("Karajan");
  });
  it("returns null for empty / nullish", () => {
    expect(prettifyName("")).toBeNull();
    expect(prettifyName("   ")).toBeNull();
    expect(prettifyName(null)).toBeNull();
    expect(prettifyName(undefined)).toBeNull();
  });
});

describe("readPackageJsonName", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-pkgname-"));
  });
  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns the name field when present", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "weather-dashboard" }));
    expect(readPackageJsonName(tmp)).toBe("weather-dashboard");
  });

  it("strips npm scope (@org/name → name)", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "@manu/weather-dashboard" }));
    expect(readPackageJsonName(tmp)).toBe("weather-dashboard");
  });

  it("returns null when no package.json", () => {
    expect(readPackageJsonName(tmp)).toBeNull();
  });

  it("returns null when package.json is invalid JSON", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{ broken");
    expect(readPackageJsonName(tmp)).toBeNull();
  });

  it("returns null when name field is missing or empty", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ version: "1.0.0" }));
    expect(readPackageJsonName(tmp)).toBeNull();
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "  " }));
    expect(readPackageJsonName(tmp)).toBeNull();
  });
});

describe("readGitRemoteBasename", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gitname-"));
    execSync(`git -C "${tmp}" init -q`);
  });
  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns the basename of an SSH-style remote URL", () => {
    execSync(`git -C "${tmp}" remote add origin git@github.com:manufosela/weather-dashboard.git`);
    expect(readGitRemoteBasename(tmp)).toBe("weather-dashboard");
  });

  it("returns the basename of an HTTPS remote URL without .git", () => {
    execSync(`git -C "${tmp}" remote add origin https://github.com/manufosela/weather-dashboard`);
    expect(readGitRemoteBasename(tmp)).toBe("weather-dashboard");
  });

  it("returns null when no remote is configured", () => {
    expect(readGitRemoteBasename(tmp)).toBeNull();
  });

  it("returns null when the directory is not a git repo", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "kj-nogit-"));
    try {
      expect(readGitRemoteBasename(empty)).toBeNull();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("readCwdBasename", () => {
  it("returns the trailing directory name", () => {
    expect(readCwdBasename("/home/manu/weather-dashboard")).toBe("weather-dashboard");
  });
  it("returns null for filesystem root", () => {
    expect(readCwdBasename("/")).toBeNull();
  });
});

describe("deriveProjectNameFromCwd — priority order", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kj-projname-"));
  });
  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("prefers package.json name over everything else", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "from-pkg" }));
    execSync(`git -C "${tmp}" init -q`);
    execSync(`git -C "${tmp}" remote add origin git@github.com:foo/from-git.git`);
    expect(deriveProjectNameFromCwd(tmp)).toBe("From Pkg");
  });

  it("falls back to git remote when no package.json", () => {
    execSync(`git -C "${tmp}" init -q`);
    execSync(`git -C "${tmp}" remote add origin git@github.com:foo/from-git.git`);
    expect(deriveProjectNameFromCwd(tmp)).toBe("From Git");
  });

  it("falls back to directory basename when no package.json + no remote", () => {
    // The tmp dir is something like /tmp/kj-projname-XXXXXX. We rename it to
    // a predictable name so the assertion is stable.
    const named = path.join(path.dirname(tmp), "weather-dashboard-test");
    fs.renameSync(tmp, named);
    try {
      expect(deriveProjectNameFromCwd(named)).toBe("Weather Dashboard Test");
    } finally {
      fs.rmSync(named, { recursive: true, force: true });
      tmp = named; // so afterEach's rm doesn't blow up trying to clean the old path
    }
  });
});
