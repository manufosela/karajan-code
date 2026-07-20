// ENV-E1 (KJC-TSK-0640): rag query must delta-update the index on drift
// BEFORE searching, passing the caller's flags through so --no-rag-update
// and config.rag.autoUpdate keep working as escape hatches.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/rag/auto-update.js", () => ({
  maybeAutoUpdate: vi.fn().mockResolvedValue({ ran: true }),
  installPostMergeHook: vi.fn(),
}));
vi.mock("../../src/rag/vec-store.js", () => ({
  openVecStore: vi.fn(() => ({ close: vi.fn() })),
  projectSlug: vi.fn(() => "proj"),
  getLastIndexedCommit: vi.fn(),
  setLastIndexedCommit: vi.fn(),
  countChunks: vi.fn(() => 0),
}));
vi.mock("../../src/rag/embedders/factory.js", () => ({ makeEmbedder: vi.fn(() => ({})) }));
vi.mock("../../src/rag/indexer.js", () => ({ indexProject: vi.fn(), indexProjectDelta: vi.fn() }));
vi.mock("../../src/rag/retriever.js", () => ({ query: vi.fn().mockResolvedValue([]) }));
vi.mock("../../src/rag/eval.js", () => ({ loadGoldenQueries: vi.fn(), runEval: vi.fn() }));

import { ragQueryCommand } from "../../src/commands/rag.js";
import { maybeAutoUpdate } from "../../src/rag/auto-update.js";
import { openVecStore } from "../../src/rag/vec-store.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("rag query drift check", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delta-updates before opening the store, passing flags through", async () => {
    const config = { projectDir: "/tmp/p", rag: {} };
    const flags = { ragUpdate: false };
    await ragQueryCommand({ text: "q", config, logger, flags });
    expect(maybeAutoUpdate).toHaveBeenCalledTimes(1);
    const call = maybeAutoUpdate.mock.calls[0][0];
    expect(call.projectDir).toBe("/tmp/p");
    expect(call.flags).toBe(flags);
    // ordering: the update ran before the store was opened for the search
    expect(maybeAutoUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(openVecStore.mock.invocationCallOrder[0]);
  });
});
