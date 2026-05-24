// KJC-TSK-0437 — `kj ollama` subcommands (unit, not full CLI bootstrap).
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/rag/ollama-manager.js", () => ({
  ollamaUp: vi.fn(), ollamaDown: vi.fn(), isOllamaReachable: vi.fn(),
  normalizeOllamaConfig: vi.fn((o = {}) => ({
    host: o.host || "http://localhost:11434",
    containerName: o.container_name || "kj-ollama",
    timeouts: { healthcheckSeconds: 5 },
  })),
}));
vi.mock("../../src/rag/ollama-capability.js", () => ({ pullOllamaModel: vi.fn() }));

import { ollamaUp, ollamaDown, isOllamaReachable } from "../../src/rag/ollama-manager.js";
import { pullOllamaModel } from "../../src/rag/ollama-capability.js";
import {
  ollamaStartCommand, ollamaStopCommand, ollamaStatusCommand, ollamaPullCommand,
} from "../../src/commands/ollama.js";

const logger = { info: vi.fn(), warn: vi.fn() };

describe("kj ollama subcommands — KJC-TSK-0437", () => {
  beforeEach(() => {
    ollamaUp.mockReset(); ollamaDown.mockReset();
    isOllamaReachable.mockReset(); pullOllamaModel.mockReset();
    logger.info.mockReset(); logger.warn.mockReset();
  });

  it("start: success path logs 'started', reused host logs 'Reusing'", async () => {
    ollamaUp.mockResolvedValueOnce({ exitCode: 0, stdout: "Started", stderr: "" });
    await ollamaStartCommand({ config: {}, logger });
    expect(logger.info).toHaveBeenCalledWith("Ollama container started.");
    ollamaUp.mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "", reusedHost: "http://localhost:11434" });
    await ollamaStartCommand({ config: {}, logger });
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/Reusing Ollama/));
  });
  it("stop delegates to ollamaDown", async () => {
    ollamaDown.mockResolvedValue({ exitCode: 0, stdout: "stopped", stderr: "" });
    await ollamaStopCommand({ config: {}, logger });
    expect(logger.info).toHaveBeenCalledWith("stopped");
  });
  it("status logs info when reachable, warns + hint when not", async () => {
    isOllamaReachable.mockResolvedValueOnce(true);
    expect((await ollamaStatusCommand({ config: {}, logger })).reachable).toBe(true);
    isOllamaReachable.mockResolvedValueOnce(false);
    await ollamaStatusCommand({ config: {}, logger });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/kj ollama start/));
  });
  it("pull invokes pullOllamaModel with the model arg", async () => {
    pullOllamaModel.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    await ollamaPullCommand({ model: "nomic-embed-text", config: {}, logger });
    expect(pullOllamaModel).toHaveBeenCalledWith("nomic-embed-text", expect.any(Object));
  });
  it("pull rejects when model arg missing", async () => {
    await expect(ollamaPullCommand({ config: {}, logger })).rejects.toThrow(/model argument required/);
  });
});
