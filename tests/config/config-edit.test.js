import { describe, expect, it, vi, beforeEach } from "vitest";
import yaml from "js-yaml";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0 }))
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("../src/utils/fs.js", () => ({
  ensureDir: vi.fn(),
  exists: vi.fn().mockResolvedValue(true)
}));

describe("editConfigOnce", () => {
  let editConfigOnce;
  let fs;
  let spawnSync;

  beforeEach(async () => {
    vi.resetAllMocks();

    const fsMod = await import("node:fs/promises");
    fs = fsMod.default;

    const cpMod = await import("node:child_process");
    spawnSync = cpMod.spawnSync;
    spawnSync.mockReturnValue({ status: 0 });

    const mod = await import("../src/commands/config.js");
    editConfigOnce = mod.editConfigOnce;
  });

  it("opens editor and returns ok when config is valid", async () => {
    const validYaml = yaml.dump({
      coder: "claude",
      reviewer: "codex",
      review_mode: "standard",
      max_iterations: 5,
      development: { methodology: "tdd" }
    });
    fs.readFile.mockResolvedValue(validYaml);

    const result = await editConfigOnce("/tmp/kj.config.yml");

    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.config).toBeTruthy();
  });

  it("uses VISUAL env var first for editor", async () => {
    const orig = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
    process.env.VISUAL = "code --wait";
    process.env.EDITOR = "nano";

    fs.readFile.mockResolvedValue(yaml.dump({ coder: "claude", reviewer: "codex", review_mode: "standard", development: { methodology: "tdd" } }));

    await editConfigOnce("/tmp/kj.config.yml");

    expect(spawnSync).toHaveBeenCalledWith(
      "code",
      expect.arrayContaining(["--wait", "/tmp/kj.config.yml"]),
      expect.any(Object)
    );

    process.env.VISUAL = orig.VISUAL;
    process.env.EDITOR = orig.EDITOR;
  });

  it("falls back to EDITOR when VISUAL is not set", async () => {
    const orig = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
    delete process.env.VISUAL;
    process.env.EDITOR = "nano";

    fs.readFile.mockResolvedValue(yaml.dump({ coder: "claude", reviewer: "codex", review_mode: "standard", development: { methodology: "tdd" } }));

    await editConfigOnce("/tmp/kj.config.yml");

    expect(spawnSync).toHaveBeenCalledWith(
      "nano",
      ["/tmp/kj.config.yml"],
      expect.any(Object)
    );

    process.env.VISUAL = orig.VISUAL;
    process.env.EDITOR = orig.EDITOR;
  });

  it("returns error when editor exits with non-zero", async () => {
    spawnSync.mockReturnValue({ status: 1 });

    const result = await editConfigOnce("/tmp/kj.config.yml");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/editor exited/i);
  });

  it("returns error when YAML is invalid", async () => {
    fs.readFile.mockResolvedValue("invalid: yaml: [broken");

    const result = await editConfigOnce("/tmp/kj.config.yml");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/YAML/i);
  });

  it("returns error when config validation fails", async () => {
    const invalidConfig = yaml.dump({
      coder: "claude",
      reviewer: "codex",
      review_mode: "invalid_mode",
      development: { methodology: "tdd" }
    });
    fs.readFile.mockResolvedValue(invalidConfig);

    const result = await editConfigOnce("/tmp/kj.config.yml");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/review_mode/i);
  });

  it("returns error when saved file cannot be read", async () => {
    fs.readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await editConfigOnce("/tmp/kj.config.yml");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ENOENT/);
  });
});
