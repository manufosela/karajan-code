// KJC-TSK-0437 — `kj doctor` Ollama check.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/rag/ollama-manager.js", () => ({
  isOllamaReachable: vi.fn(),
  normalizeOllamaConfig: vi.fn((o = {}) => ({ host: o.host || "http://localhost:11434" })),
}));
import { isOllamaReachable } from "../../src/rag/ollama-manager.js";
import { getOllamaChecks } from "../../src/checks/ollama.js";

describe("checks/ollama — KJC-TSK-0437", () => {
  beforeEach(() => isOllamaReachable.mockReset());

  it("reports disabled when rag.preload.enabled !== true", async () => {
    const [check] = getOllamaChecks();
    const r = await check.detect({ config: { rag: { preload: { enabled: false } } } });
    expect(r).toMatchObject({ ok: true, severity: "info" });
    expect(r.detail).toMatch(/Disabled/);
    expect(isOllamaReachable).not.toHaveBeenCalled();
  });

  it("ok when reachable", async () => {
    isOllamaReachable.mockResolvedValue(true);
    const [check] = getOllamaChecks();
    const r = await check.detect({ config: { rag: { preload: { enabled: true } } } });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/Reachable/);
  });

  it("warn when unreachable, with fix hint pointing at kj ollama start", async () => {
    isOllamaReachable.mockResolvedValue(false);
    const [check] = getOllamaChecks();
    const r = await check.detect({ config: { rag: { preload: { enabled: true } } } });
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("warn");
    expect(r.fix).toMatch(/kj ollama start/);
  });

  describe("HU-3280 — CPU hint for the managed kj-ollama", () => {
    const run = (embedder, reachable = true) => {
      isOllamaReachable.mockResolvedValue(reachable);
      const [check] = getOllamaChecks();
      return check.detect({ config: { rag: { preload: { enabled: true }, embedder } } });
    };

    it("hints how to limit the CPU or use a native Ollama when kj manages the container", async () => {
      for (const embedder of [undefined, { provider: "ollama" }]) {
        const r = await run(embedder);
        expect(r.detail).toMatch(/docker update --cpus/);
        expect(r.detail).toMatch(/external/);
        expect(r).toMatchObject({ ok: true, severity: "info" });
      }
    });

    it("keeps the warn severity and fix when unreachable", async () => {
      const r = await run(undefined, false);
      expect(r).toMatchObject({ ok: false, severity: "warn" });
      expect(r.detail).toMatch(/docker update --cpus/);
    });

    it("stays silent for an external Ollama or another provider", async () => {
      expect((await run({ external: true })).detail).not.toMatch(/--cpus/);
      expect((await run({ provider: "openai" })).detail).not.toMatch(/--cpus/);
    });
  });

});
