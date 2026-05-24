// KJC-TSK-0436 — capability check + model pull.
import { describe, expect, it, vi, beforeEach } from "vitest";
import os from "node:os";

vi.mock("../../src/utils/process.js", () => ({ runCommand: vi.fn() }));
import { runCommand } from "../../src/utils/process.js";
import {
  checkDockerAvailable, checkRamCapacity, checkOllamaCapability, pullOllamaModel,
} from "../../src/rag/ollama-capability.js";

describe("ollama-capability — KJC-TSK-0436", () => {
  beforeEach(() => runCommand.mockReset());

  it("checkDockerAvailable=ok when docker --version + docker info succeed", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 0 }).mockResolvedValueOnce({ exitCode: 0 });
    expect(await checkDockerAvailable()).toEqual({ ok: true });
  });
  it("checkDockerAvailable flags not-installed when --version exits non-zero", async () => {
    runCommand.mockResolvedValue({ exitCode: 127 });
    expect(await checkDockerAvailable()).toEqual({ ok: false, reason: "docker:not-installed" });
  });
  it("checkDockerAvailable flags daemon-unreachable when info fails", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 0 }).mockResolvedValueOnce({ exitCode: 1 });
    expect(await checkDockerAvailable()).toEqual({ ok: false, reason: "docker:daemon-unreachable" });
  });

  it("checkRamCapacity passes when free RAM >= minBytes", () => {
    const free = os.freemem();
    expect(checkRamCapacity(free - 1)).toMatchObject({ ok: true });
  });
  it("checkRamCapacity fails with reason when below minBytes", () => {
    const r = checkRamCapacity(os.totalmem() * 10);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ram:insufficient/);
  });

  it("checkOllamaCapability aggregates docker + ram reasons", async () => {
    runCommand.mockResolvedValue({ exitCode: 127 });
    const r = await checkOllamaCapability({ minRamBytes: os.totalmem() * 10 });
    expect(r.capable).toBe(false);
    expect(r.reasons).toContain("docker:not-installed");
    expect(r.reasons.find((s) => s.startsWith("ram:insufficient"))).toBeTruthy();
  });

  it("checkOllamaCapability reports capable=true when both checks pass", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 0 }).mockResolvedValueOnce({ exitCode: 0 });
    const r = await checkOllamaCapability({ minRamBytes: 1 });
    expect(r.capable).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("pullOllamaModel invokes docker exec with ollama pull <model>", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "pulled", stderr: "" });
    await pullOllamaModel("nomic-embed-text");
    expect(runCommand).toHaveBeenCalledWith(
      "docker",
      ["exec", "kj-ollama", "ollama", "pull", "nomic-embed-text"],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });
  it("pullOllamaModel rejects when model missing", async () => {
    await expect(pullOllamaModel()).rejects.toThrow(/model is required/);
  });
});
