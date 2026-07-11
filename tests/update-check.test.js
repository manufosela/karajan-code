import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkForUpdate,
  updateInstruction,
  INSTALL_SH_URL,
  INSTALL_PS1_URL,
} from "../src/utils/update-check.js";
import fs from "node:fs/promises";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
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
