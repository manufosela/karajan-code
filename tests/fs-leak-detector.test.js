import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  snapshotHomeTopLevel, detectNewHomeEntries, formatLeakMessage,
  verifyLeaksAgainstTranscript, detectTranscriptCdLeaks,
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

describe("verifyLeaksAgainstTranscript (issue #546 — host-write false positives)", () => {
  it("filters out leaks the coder never mentioned (concurrent host write scenario)", () => {
    // 2026-04-29 incident: host AI wrote ~/karajan-status-snapshot.md
    // mid-coder-iteration. Snapshot diff flagged it. Coder transcript
    // never mentions that file → not attributable, must be filtered.
    const leaks = ["/home/manu/karajan-status-snapshot.md"];
    const transcript = "I read tests/foo.test.js and modified src/bar.js. Ran npm test. All green.";
    expect(verifyLeaksAgainstTranscript(leaks, transcript)).toEqual([]);
  });

  it("keeps leaks the coder mentioned by absolute path (real coder leak)", () => {
    const leaks = ["/home/manu/assistant"];
    const transcript = "cd /home/manu/assistant && pnpm init -y\nCreated package.json at /home/manu/assistant.";
    expect(verifyLeaksAgainstTranscript(leaks, transcript)).toEqual(["/home/manu/assistant"]);
  });

  it("keeps leaks the coder mentioned by basename only", () => {
    const leaks = ["/home/manu/assistant"];
    const transcript = "I'll create the assistant directory and put the skeleton there.";
    expect(verifyLeaksAgainstTranscript(leaks, transcript)).toEqual(["/home/manu/assistant"]);
  });

  it("returns all leaks unchanged when transcript is empty (back-compat — strict)", () => {
    const leaks = ["/home/x/foo", "/home/x/bar"];
    expect(verifyLeaksAgainstTranscript(leaks, "")).toEqual(leaks);
    expect(verifyLeaksAgainstTranscript(leaks, null)).toEqual(leaks);
    expect(verifyLeaksAgainstTranscript(leaks, undefined)).toEqual(leaks);
  });

  it("returns empty when leaks input is empty", () => {
    expect(verifyLeaksAgainstTranscript([], "anything")).toEqual([]);
    expect(verifyLeaksAgainstTranscript(null, "anything")).toEqual([]);
  });

  it("does not attempt basename matching for very short basenames (would over-match)", () => {
    // ".sh" / ".x" are too short to discriminate. Keep the strict
    // behaviour: pass through untouched, let the user inspect.
    const leaks = ["/home/x/.sh"];
    expect(verifyLeaksAgainstTranscript(leaks, "no mention of anything"))
      .toEqual(["/home/x/.sh"]);
  });

  it("handles a transcript that contains many path-like fragments without crashing", () => {
    const leaks = ["/home/x/assistant"];
    const transcript = "src/foo.js\nsrc/bar.js\nsrc/baz.js\nassistant\nfile.txt\n".repeat(100);
    expect(verifyLeaksAgainstTranscript(leaks, transcript)).toEqual(["/home/x/assistant"]);
  });
});

describe("detectTranscriptCdLeaks (BUG-0032 layer 2 — cd-then-write outside projectDir)", () => {
  it("flags `cd /abs && pnpm init` when target is outside projectDir", () => {
    const transcript = "cd /home/manu/assistant && pnpm init -y\nDone.";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toContain("/home/manu/assistant");
  });

  it("flags `cd /abs && mkdir foo` when target is outside projectDir", () => {
    const transcript = "cd /opt/other && mkdir -p src/index.js";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toContain("/opt/other");
  });

  it("flags `cd /abs && touch file.txt`", () => {
    const transcript = "cd /var/data && touch new.csv";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toContain("/var/data");
  });

  it("flags `cd /abs && git init`", () => {
    const transcript = "cd /home/manu/other-proj && git init";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toContain("/home/manu/other-proj");
  });

  it("flags `cd /abs && echo ... > file`", () => {
    const transcript = "cd /home/manu/x && echo 'hi' > config.yaml";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toContain("/home/manu/x");
  });

  it("does NOT flag `cd /abs && ls` (pure read command)", () => {
    const transcript = "cd /usr/local/bin && ls -la";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toEqual([]);
  });

  it("does NOT flag `cd /abs && which node` (read command)", () => {
    const transcript = "cd /usr && which node";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toEqual([]);
  });

  it("does NOT flag `cd <relative> && pnpm init` (relative paths are inside projectDir)", () => {
    const transcript = "cd subdir && pnpm init -y";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toEqual([]);
  });

  it("does NOT flag when target is INSIDE projectDir", () => {
    const transcript = "cd /home/manu/proj/sub && pnpm init -y";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toEqual([]);
  });

  it("does NOT flag /tmp (ephemeral, legitimate scratch space)", () => {
    const transcript = "cd /tmp/scratch && touch test.txt";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toEqual([]);
  });

  it("handles ~/path expansion", () => {
    const home = process.env.HOME;
    const transcript = "cd ~/rogue && pnpm init -y";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toContain(`${home}/rogue`);
  });

  it("handles $HOME expansion", () => {
    const home = process.env.HOME;
    const transcript = "cd $HOME/rogue && touch x.js";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks).toContain(`${home}/rogue`);
  });

  it("deduplicates leaks across multiple cd commands to the same dir", () => {
    const transcript = "cd /opt/x && touch a\ncd /opt/x && touch b";
    const leaks = detectTranscriptCdLeaks(transcript, "/home/manu/proj");
    expect(leaks.filter(l => l === "/opt/x")).toHaveLength(1);
  });

  it("returns [] for empty/null transcript", () => {
    expect(detectTranscriptCdLeaks("", "/proj")).toEqual([]);
    expect(detectTranscriptCdLeaks(null, "/proj")).toEqual([]);
    expect(detectTranscriptCdLeaks(undefined, "/proj")).toEqual([]);
  });

  it("does NOT crash when projectDir is null", () => {
    const leaks = detectTranscriptCdLeaks("cd /opt/x && touch a", null);
    expect(Array.isArray(leaks)).toBe(true);
  });
});

describe("worktree safety (KJC-TSK-0625, épica KJC-PCS-0065)", () => {
  it("parallel worktrees under projectDir/.karajan/worktrees never register as leaks", () => {
    // projectDir under $HOME, snapshotted BEFORE the run — the real layout.
    const projectDir = path.join(tmpHome, "myproj");
    fs.mkdirSync(projectDir, { recursive: true });
    const before = snapshotHomeTopLevel();

    // A parallel run creates worktrees INSIDE the project: no new $HOME entry.
    fs.mkdirSync(path.join(projectDir, ".karajan", "worktrees", "HU-001"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, ".karajan", "worktrees", "HU-001", "a.js"), "x");
    expect(detectNewHomeEntries(before, projectDir)).toEqual([]);

    // Control: a genuine stray $HOME entry still trips the detector.
    fs.writeFileSync(path.join(tmpHome, "stray.md"), "leak");
    expect(detectNewHomeEntries(before, projectDir)).toEqual([path.join(tmpHome, "stray.md")]);
  });
});
