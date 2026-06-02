import { describe, it, expect, vi, afterEach } from "vitest";
import os from "node:os";

const statfsMock = vi.fn();
vi.mock("node:fs/promises", () => ({ statfs: (...a) => statfsMock(...a) }));

const { getHardwareChecks, __test } = await import("../../src/checks/hardware.js");
const { RAM_WARN_GB, RAM_RECOMMENDED_GB, DISK_WARN_GB, bytesToGb } = __test;

const byName = () => Object.fromEntries(getHardwareChecks().map((c) => [c.name, c]));
const GB = 1024 ** 3;

describe("checks/hardware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    statfsMock.mockReset();
  });

  it("bytesToGb rounds to one decimal", () => {
    expect(bytesToGb(GB)).toBe(1);
    expect(bytesToGb(1.5 * GB)).toBe(1.5);
  });

  it("hw-ram warns below threshold", async () => {
    vi.spyOn(os, "totalmem").mockReturnValue((RAM_WARN_GB - 1) * GB);
    vi.spyOn(os, "freemem").mockReturnValue(0.5 * GB);
    const r = await byName()["hw-ram"].detect({ config: {} });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("warn");
    expect(r.fix).toMatch(/no-rag|cloud/i);
    expect(r.extra.threshold).toBe(RAM_WARN_GB);
  });

  it("hw-ram is ok between warn and recommended", async () => {
    vi.spyOn(os, "totalmem").mockReturnValue((RAM_RECOMMENDED_GB - 1) * GB);
    vi.spyOn(os, "freemem").mockReturnValue(2 * GB);
    const r = await byName()["hw-ram"].detect({ config: {} });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/recommended/i);
  });

  it("hw-cpu reports cores, arch and model", async () => {
    vi.spyOn(os, "cpus").mockReturnValue([{ model: "Test CPU" }, { model: "Test CPU" }]);
    vi.spyOn(os, "arch").mockReturnValue("x64");
    const r = await byName()["hw-cpu"].detect({ config: {} });
    expect(r.extra).toMatchObject({ cores: 2, arch: "x64" });
    expect(r.detail).toMatch(/Test CPU/);
  });

  it("hw-disk warns below threshold", async () => {
    statfsMock.mockResolvedValue({ bsize: 4096, bavail: 100 });
    const r = await byName()["hw-disk"].detect({ config: {} });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("warn");
    expect(r.extra.threshold).toBe(DISK_WARN_GB);
  });

  it("hw-disk is ok with plenty of free space", async () => {
    statfsMock.mockResolvedValue({ bsize: 4096, bavail: (50 * GB) / 4096 });
    const r = await byName()["hw-disk"].detect({ config: {} });
    expect(r.ok).toBe(true);
    expect(r.extra.freeGb).toBeGreaterThan(DISK_WARN_GB);
  });

  it("hw-disk does not throw when statfs fails", async () => {
    statfsMock.mockRejectedValue(new Error("boom"));
    const r = await byName()["hw-disk"].detect({ config: {} });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/Cannot read/i);
  });

  it("getHardwareChecks returns the three advisory checks", () => {
    expect(getHardwareChecks().map((c) => c.name).sort()).toEqual(["hw-cpu", "hw-disk", "hw-ram"]);
  });
});
