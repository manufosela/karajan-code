import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkForUpdate,
  updateInstruction,
  parseChangelogHighlight,
  performSelfUpdate,
  INSTALL_SH_URL,
  INSTALL_PS1_URL,
} from "../src/utils/update-check.js";
import fs from "node:fs/promises";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
  },
}));

describe("update-check", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fs.readFile.mockRejectedValue(new Error("no cache"));
    fs.writeFile.mockResolvedValue();
    fs.mkdir.mockResolvedValue();
    global.fetch = vi.fn();
  });

  it("returns null when npm returns same version", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.38.2" }),
    });
    const result = await checkForUpdate("1.38.2");
    expect(result).toBeNull();
  });

  // KJC-TSK-0690: the notice tells the user WHAT the new version brings —
  // the headline is the first paragraph of the version's CHANGELOG section.
  it("parses the version headline from the changelog (bold stripped, truncated)", () => {
    const md = "# Changelog\n\n## [Unreleased]\n\n## [4.6.0] - 2026-07-24\n\nMinor. **The method, enforced.** Rules climb to gates.\n\n### Added\n- stuff\n\n## [4.5.0] - 2026-07-24\n\nOther.\n";
    expect(parseChangelogHighlight(md, "4.6.0")).toBe("Minor. The method, enforced. Rules climb to gates.");
    expect(parseChangelogHighlight(md, "9.9.9")).toBeNull();
    expect(parseChangelogHighlight("x".repeat(10), "4.6.0")).toBeNull();
  });

  it("KJ_NO_UPDATE_CHECK=1 skips everything, including the fetch", async () => {
    process.env.KJ_NO_UPDATE_CHECK = "1";
    try {
      expect(await checkForUpdate("1.0.0")).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      delete process.env.KJ_NO_UPDATE_CHECK;
    }
  });

  it("a fresh newer version carries the changelog highlight into result and cache", async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: "2.0.0" }) })
      .mockResolvedValueOnce({ ok: true, text: async () => "## [2.0.0] - 2026-07-25\n\nMinor. **Big thing.** Details.\n" });
    const r = await checkForUpdate("1.0.0");
    expect(r).toMatchObject({ updateAvailable: true, latest: "2.0.0", highlight: "Minor. Big thing. Details." });
    const cached = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(cached.highlight).toBe("Minor. Big thing. Details.");
  });

  it("returns update info when npm has newer version", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.39.0" }),
    });
    const result = await checkForUpdate("1.38.2");
    expect(result).toEqual({
      updateAvailable: true,
      latest: "1.39.0",
      current: "1.38.2",
      highlight: null,
    });
  });

  it("returns null when npm version is older", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.37.0" }),
    });
    const result = await checkForUpdate("1.38.2");
    expect(result).toBeNull();
  });

  it("returns null when fetch fails (offline)", async () => {
    global.fetch.mockRejectedValue(new Error("network error"));
    const result = await checkForUpdate("1.38.2");
    expect(result).toBeNull();
  });

  it("returns null when npm returns non-200", async () => {
    global.fetch.mockResolvedValue({ ok: false });
    const result = await checkForUpdate("1.38.2");
    expect(result).toBeNull();
  });

  it("uses cache when fresh (no fetch)", async () => {
    fs.readFile.mockResolvedValue(
      JSON.stringify({ latest: "1.40.0", checkedAt: Date.now() })
    );
    const result = await checkForUpdate("1.38.2");
    expect(result).toEqual({
      updateAvailable: true,
      latest: "1.40.0",
      current: "1.38.2",
      highlight: null,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("ignores expired cache and fetches", async () => {
    fs.readFile.mockResolvedValue(
      JSON.stringify({ latest: "1.40.0", checkedAt: Date.now() - 25 * 60 * 60 * 1000 })
    );
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.41.0" }),
    });
    const result = await checkForUpdate("1.38.2");
    expect(result.latest).toBe("1.41.0");
    expect(global.fetch).toHaveBeenCalled();
  });

  it("saves cache after successful fetch", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.39.0" }),
    });
    await checkForUpdate("1.38.2");
    expect(fs.writeFile).toHaveBeenCalled();
    const written = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(written.latest).toBe("1.39.0");
    expect(written.checkedAt).toBeGreaterThan(0);
  });
});

describe("updateInstruction", () => {
  it("points npm installs at npm install -g", () => {
    expect(updateInstruction({ channel: "npm" })).toBe("Run: npm install -g karajan-code");
  });

  it("points SEA binaries on Unix at the shell installer, not npm", () => {
    const msg = updateInstruction({ channel: "sea", platform: "linux" });
    expect(msg).toContain(INSTALL_SH_URL);
    expect(msg).not.toContain("npm install");
  });

  it("points SEA binaries on Windows at the PowerShell installer", () => {
    const msg = updateInstruction({ channel: "sea", platform: "win32" });
    expect(msg).toContain(INSTALL_PS1_URL);
    expect(msg).toContain("iex");
  });

  it("offers both paths when the channel is unknown", () => {
    const msg = updateInstruction({ channel: "unknown" });
    expect(msg).toContain("npm install -g karajan-code");
    expect(msg).toContain("binary installer");
  });
});

describe("performSelfUpdate", () => {
  const makeLogger = () => ({ log: vi.fn(), error: vi.fn() });
  const logged = (logger) => logger.log.mock.calls.map((c) => c.join(" ")).join("\n");
  const errored = (logger) => logger.error.mock.calls.map((c) => c.join(" ")).join("\n");
  const registry = (version) =>
    vi.fn(async () => ({ ok: true, json: async () => ({ version }), text: async () => "#!/bin/sh\n" }));

  it("reports already-latest and never runs the install", async () => {
    const exec = vi.fn();
    const logger = makeLogger();
    const result = await performSelfUpdate({
      currentVersion: "3.12.0", exec, logger, channel: "npm", fetchFn: registry("3.12.0"),
    });
    expect(result).toEqual({ ok: true, alreadyLatest: true, latest: "3.12.0" });
    expect(exec).not.toHaveBeenCalled();
    expect(logged(logger)).toMatch(/Already on the latest/);
  });

  it("installs the latest, hides npm's noise, and verifies the kj on PATH", async () => {
    const noisy = "npm warn deprecated prebuild-install@7\nnpm warn allow-scripts\n100 packages are looking for funding";
    const exec = vi.fn(async (cmd) =>
      cmd === "kj" ? { stdout: "3.12.0", stderr: "" } : { stdout: noisy, stderr: noisy });
    const logger = makeLogger();
    const result = await performSelfUpdate({
      currentVersion: "3.10.2", exec, logger, channel: "npm", fetchFn: registry("3.12.0"),
    });
    expect(result).toEqual({ ok: true, latest: "3.12.0" });
    expect(exec).toHaveBeenCalledWith("npm", ["install", "-g", "karajan-code@latest"]);
    expect(exec).toHaveBeenCalledWith("kj", ["--version"]);
    const out = logged(logger);
    expect(out).toMatch(/Updated to 3\.12\.0/);
    // The whole point: none of npm's plumbing reaches the user on success.
    expect(out).not.toMatch(/npm warn|deprecated|allow-scripts|funding/);
  });

  it("fails LOUDLY when the kj on PATH still reports the old version (KJC-BUG-0106)", async () => {
    // The user's laptop: npm installs 3.12.2 into its prefix, but the SEA
    // binary earlier on PATH keeps answering 3.10.2.
    const exec = vi.fn(async (cmd) =>
      cmd === "kj" ? { stdout: "3.10.2", stderr: "" } : { stdout: "", stderr: "" });
    const logger = makeLogger();
    const result = await performSelfUpdate({
      currentVersion: "3.10.2", exec, logger, channel: "npm", fetchFn: registry("3.12.2"),
    });
    expect(result).toEqual({ ok: false });
    const out = errored(logger);
    expect(out).toMatch(/still reports 3\.10\.2/);
    expect(out).toMatch(/which -a kj/);
    expect(logged(logger)).not.toMatch(/Updated to/); // no false success line
  });

  it("sea channel re-runs the downloaded installer instead of npm (KJC-BUG-0106)", async () => {
    const exec = vi.fn(async (cmd) =>
      cmd === "kj" ? { stdout: "3.12.2", stderr: "" } : { stdout: "", stderr: "" });
    const logger = makeLogger();
    const result = await performSelfUpdate({
      currentVersion: "3.10.2", exec, logger, channel: "sea", fetchFn: registry("3.12.2"),
    });
    expect(result).toEqual({ ok: true, latest: "3.12.2" });
    // Installer executed from a temp file via sh — npm never invoked.
    const cmds = exec.mock.calls.map((c) => c[0]);
    expect(cmds).toContain("sh");
    expect(cmds).not.toContain("npm");
    expect(exec).toHaveBeenCalledWith("kj", ["--version"]);
  });

  it("surfaces the captured npm output and fails loudly when install errors", async () => {
    const err = Object.assign(new Error("Command failed with exit code 1"), {
      shortMessage: "npm install failed",
      stdout: "gyp ERR! build error",
      stderr: "node-gyp rebuild failed",
    });
    const exec = vi.fn(async () => { throw err; });
    const logger = makeLogger();
    const result = await performSelfUpdate({
      currentVersion: "3.10.2", exec, logger, channel: "npm", fetchFn: registry("3.12.0"),
    });
    expect(result).toEqual({ ok: false });
    const out = errored(logger);
    expect(out).toMatch(/gyp ERR! build error/);
    expect(out).toMatch(/node-gyp rebuild failed/);
    expect(out).toMatch(/Update failed/);
  });

  it("fails cleanly when the registry lookup itself errors", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("network down"); });
    const logger = makeLogger();
    const result = await performSelfUpdate({
      currentVersion: "3.10.2", exec: vi.fn(), logger, channel: "npm", fetchFn,
    });
    expect(result).toEqual({ ok: false });
    expect(errored(logger)).toMatch(/Update failed/);
  });
});
