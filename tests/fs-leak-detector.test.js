import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  snapshotHomeTopLevel, detectNewHomeEntries, formatLeakMessage,
} from "../src/orchestrator/fs-leak-detector.js";

// KJC-BUG-0032 (PR-I): the coder's Bash tool can `cd` anywhere and
// create files under $HOME. The detector snapshots $HOME's top-level
// before the coder runs and reports any new entry afterwards.

let savedHome;
let tmpHome;

beforeEach(() => {
  // Point HOME at a tmp dir so the test doesn't touch the developer's
  // real $HOME (and so it doesn't false-positive on whatever happens
  // to be in $HOME during CI).
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kj-fsleak-"));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  // os.homedir() reads HOME — re-evaluating the module would be cleaner
  // but the helpers re-read it on every call, so this is enough.
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("snapshotHomeTopLevel", () => {
  it("returns the immediate children of $HOME as a Set", () => {
    fs.mkdirSync(path.join(tmpHome, "ws"));
    fs.mkdirSync(path.join(tmpHome, ".cache"));
    fs.writeFileSync(path.join(tmpHome, ".bashrc"), "# x");
    const snap = snapshotHomeTopLevel();
    expect(snap).toBeInstanceOf(Set);
    expect(snap.has("ws")).toBe(true);
    expect(snap.has(".cache")).toBe(true);
    expect(snap.has(".bashrc")).toBe(true);
  });

  it("returns an empty Set when $HOME is unreadable", () => {
    process.env.HOME = "/nonexistent/path/for/testing";
    const snap = snapshotHomeTopLevel();
    expect(snap).toBeInstanceOf(Set);
    expect(snap.size).toBe(0);
  });
});

describe("detectNewHomeEntries", () => {
  it("returns empty when nothing changed in $HOME", () => {
    fs.mkdirSync(path.join(tmpHome, "ws"));
    const before = snapshotHomeTopLevel();
    const leaks = detectNewHomeEntries(before, "/some/projectDir");
    expect(leaks).toEqual([]);
  });

  it("flags new top-level directories created since the snapshot", () => {
    fs.mkdirSync(path.join(tmpHome, "ws"));
    const before = snapshotHomeTopLevel();
    // Simulate the bug — coder creates ~/assistant
    fs.mkdirSync(path.join(tmpHome, "assistant"));
    fs.writeFileSync(path.join(tmpHome, "assistant", "package.json"), "{}");
    const leaks = detectNewHomeEntries(before, "/some/projectDir");
    expect(leaks).toEqual([path.join(tmpHome, "assistant")]);
  });

  it("flags new top-level files too (not just dirs)", () => {
    const before = snapshotHomeTopLevel();
    fs.writeFileSync(path.join(tmpHome, "rogue.sh"), "#!/bin/bash");
    const leaks = detectNewHomeEntries(before, "/some/projectDir");
    expect(leaks).toEqual([path.join(tmpHome, "rogue.sh")]);
  });

  it("does NOT flag projectDir even if it equals a $HOME child path", () => {
    fs.mkdirSync(path.join(tmpHome, "my-project"));
    const before = snapshotHomeTopLevel();
    // Simulate a sub-write inside projectDir — top-level snapshot
    // already had `my-project`, so no new entry → no leak.
    fs.writeFileSync(path.join(tmpHome, "my-project", "x.js"), "x");
    const leaks = detectNewHomeEntries(before, path.join(tmpHome, "my-project"));
    expect(leaks).toEqual([]);
  });

  it("excludes projectDir from the leak list when it appears as a NEW $HOME entry (defensive)", () => {
    const before = snapshotHomeTopLevel();
    fs.mkdirSync(path.join(tmpHome, "fresh-project"));
    const leaks = detectNewHomeEntries(before, path.join(tmpHome, "fresh-project"));
    expect(leaks).toEqual([]);
  });

  it("returns absolute paths so callers can show actionable info", () => {
    const before = snapshotHomeTopLevel();
    fs.mkdirSync(path.join(tmpHome, "leak"));
    const leaks = detectNewHomeEntries(before, "/somewhere/else");
    expect(leaks[0].startsWith("/")).toBe(true);
    expect(leaks[0]).toBe(path.join(tmpHome, "leak"));
  });

  it("handles projectDir=null gracefully", () => {
    const before = snapshotHomeTopLevel();
    fs.mkdirSync(path.join(tmpHome, "leak"));
    const leaks = detectNewHomeEntries(before, null);
    expect(leaks).toEqual([path.join(tmpHome, "leak")]);
  });
});

describe("formatLeakMessage", () => {
  it("includes every leak path on its own line", () => {
    const msg = formatLeakMessage(["/home/x/assistant", "/home/x/rogue.sh"], "/proj");
    expect(msg).toContain("- /home/x/assistant");
    expect(msg).toContain("- /home/x/rogue.sh");
  });

  it("mentions the projectDir so the user knows what was expected", () => {
    const msg = formatLeakMessage(["/home/x/y"], "/home/user/proj");
    expect(msg).toContain("/home/user/proj");
  });

  it("includes recovery hints in plain Spanish", () => {
    const msg = formatLeakMessage(["/home/x/y"], "/proj");
    expect(msg).toMatch(/relativas a la raíz del proyecto/i);
    expect(msg).toMatch(/Inspecciona/);
    expect(msg).toMatch(/Borra/);
    expect(msg).toMatch(/Edita el título/);
  });
});
