import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  default: {
    stat: vi.fn(),
    mkdir: vi.fn(),
  },
}));

describe("checks/dir-setup", () => {
  let mod, fs;

  beforeEach(async () => {
    vi.resetAllMocks();
    mod = await import("../../src/checks/dir-setup.js");
    fs = (await import("node:fs/promises")).default;
  });

  it("passes when all dirs exist", async () => {
    fs.stat.mockResolvedValue({ isDirectory: () => true });
    const check = mod.createKarajanDirsCheck();
    const result = await check.detect({});
    expect(result.ok).toBe(true);
  });

  it("reports missing directories and remediate creates them", async () => {
    fs.stat.mockImplementation(async (p) => {
      if (p.endsWith("sessions") || p.endsWith("logs")) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return { isDirectory: () => true };
    });
    const check = mod.createKarajanDirsCheck();
    const result = await check.detect({});
    expect(result.ok).toBe(false);
    expect(result.extra.missing.length).toBe(2);

    fs.mkdir.mockResolvedValue(undefined);
    const rem = await check.remediate({ extra: result.extra });
    expect(rem.fixed).toBe(true);
    expect(fs.mkdir).toHaveBeenCalledTimes(2);
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("sessions"), { recursive: true });
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("logs"), { recursive: true });
  });

  it("is marked auto strategy", () => {
    expect(mod.createKarajanDirsCheck().strategy).toBe("auto");
  });
});
