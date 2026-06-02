import { describe, it, expect, vi, afterEach } from "vitest";
import os from "node:os";
import { EventEmitter } from "node:events";

const statfsMock = vi.fn();
const spawnMock = vi.fn();
vi.mock("node:fs/promises", () => ({ statfs: (...a) => statfsMock(...a) }));
vi.mock("node:child_process", () => ({ spawn: (...a) => spawnMock(...a) }));

const { getHardwareChecks, __test } = await import("../../src/checks/hardware.js");
const { RAM_WARN_GB, RAM_RECOMMENDED_GB, DISK_WARN_GB, bytesToGb } = __test;

function fakeChild({ stdout = "", exitCode = 0, error } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (error) { child.emit("error", error); return; }
    if (stdout) child.stdout.emit("data", stdout);
    child.emit("close", exitCode);
  });
  return child;
}

const byName = () => Object.fromEntries(getHardwareChecks().map((c) => [c.name, c]));
const GB = 1024 ** 3;

describe("checks/hardware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    statfsMock.mockReset();
    spawnMock.mockReset();
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

  it("hw-gpu reports vendor and model when nvidia-smi succeeds", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    spawnMock.mockImplementation(() => fakeChild({ stdout: "NVIDIA RTX 3050 Ti\n", exitCode: 0 }));
    const r = await byName()["hw-gpu"].detect({ config: {} });
    expect(r.ok).toBe(true);
    expect(r.extra.detected).toBe(true);
    expect(r.extra.vendor).toBe("NVIDIA");
    expect(r.detail).toMatch(/NVIDIA RTX 3050 Ti/);
  });

  it("hw-gpu falls back gracefully when no GPU is detected", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    spawnMock.mockImplementation(() => fakeChild({ stdout: "", exitCode: 127 }));
    const r = await byName()["hw-gpu"].detect({ config: {} });
    expect(r.ok).toBe(true);
    expect(r.extra.detected).toBe(false);
    expect(r.detail).toMatch(/No discrete GPU/i);
  });

  it("hw-gpu does not throw when spawn fails", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    spawnMock.mockImplementation(() => fakeChild({ error: new Error("ENOENT") }));
    const r = await byName()["hw-gpu"].detect({ config: {} });
    expect(r.ok).toBe(true);
    expect(r.extra.detected).toBe(false);
  });

  it("getHardwareChecks returns the four advisory checks", () => {
    expect(getHardwareChecks().map((c) => c.name).sort()).toEqual(["hw-cpu", "hw-disk", "hw-gpu", "hw-ram"]);
  });
});
