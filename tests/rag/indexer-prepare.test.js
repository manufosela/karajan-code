// KJC-PCS-0052 PR-B.2.4 — prepareAdapters: activa AST en chunkers que la
// soportan. Verifica que sólo se invoca a los adapters con prepare(), que
// JS_ADAPTER no se toca y que un fallo en un grammar deja seguir al resto
// sin abortar el index.
import { describe, expect, it, vi } from "vitest";

import { prepareAdapters } from "../../src/rag/indexer.js";

describe("prepareAdapters — KJC-PCS-0052 PR-B.2.4", () => {
  it("invokes prepare() on every adapter that exposes one", async () => {
    const py = vi.fn().mockResolvedValue(undefined);
    const rs = vi.fn().mockResolvedValue(undefined);
    await prepareAdapters([
      { id: "js" },
      { id: "python", prepare: py },
      { id: "rust", prepare: rs },
    ]);
    expect(py).toHaveBeenCalledTimes(1);
    expect(rs).toHaveBeenCalledTimes(1);
  });

  it("ignores adapters without prepare (JS path)", async () => {
    // No adapter has prepare → resolves without errors.
    await expect(prepareAdapters([{ id: "js" }])).resolves.toBeUndefined();
  });

  it("logs a warning when a grammar fails, never throws", async () => {
    const logger = { warn: vi.fn() };
    const ok = vi.fn().mockResolvedValue(undefined);
    const ko = vi.fn().mockRejectedValue(new Error("wasm missing"));
    await prepareAdapters(
      [{ id: "python", prepare: ok }, { id: "rust", prepare: ko }],
      { logger },
    );
    expect(ok).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("rust prepare failed"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("wasm missing"));
  });
});
