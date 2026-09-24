/**
 * KJC-TSK-0864: the RAG answers before the coder assumes. A subprocess coder
 * cannot run `kj rag query`, so the session asks on its behalf, and an index
 * that cannot answer is said out loud instead of passing for context.
 */
import { describe, expect, it, vi } from "vitest";

import { composeTask, ragSection, resolveRagContext } from "../../src/prompts/session-context.js";

const hit = (over = {}) => ({
  source: "src/review/gate.js",
  kind: "code",
  text: "export function gate() { return true; }",
  score: 0.9,
  metadata: { symbol: "gate" },
  ...over,
});
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("ragSection", () => {
  it("names each source with its symbol and fences the excerpt", () => {
    const text = ragSection([hit()]);
    expect(text).toContain("src/review/gate.js · gate");
    expect(text).toContain("export function gate()");
    expect(text).toMatch(/open the file before changing it/);
  });

  it("truncates a long chunk instead of paying for the whole file", () => {
    const text = ragSection([hit({ text: "x".repeat(2000) })]);
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(1200);
  });

  it("nothing retrieved, no section", () => {
    expect(ragSection([])).toBeNull();
    expect(ragSection(null)).toBeNull();
  });
});

describe("resolveRagContext", () => {
  it("queries the index with the task and reports the files out loud", async () => {
    const ragQueryCommand = vi.fn(async () => [hit(), hit({ source: "src/review/other.js" })]);
    const log = logger();
    const res = await resolveRagContext({ task: "harden the gate", config: { projectDir: "/r" }, logger: log, deps: { ragQueryCommand } });

    expect(ragQueryCommand).toHaveBeenCalledWith(expect.objectContaining({ text: "harden the gate" }));
    expect(res.sources).toEqual(["src/review/gate.js", "src/review/other.js"]);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("2 file(s)"));
  });

  it("an empty index warns and returns nothing — never a silent empty context", async () => {
    const log = logger();
    const res = await resolveRagContext({ task: "t", config: {}, logger: log, deps: { ragQueryCommand: async () => [] } });
    expect(res).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("returned nothing"));
  });

  it("a broken index warns with the reason and lets the coder work", async () => {
    const log = logger();
    const res = await resolveRagContext({
      task: "t", config: {}, logger: log,
      deps: { ragQueryCommand: async () => { throw new Error("store is locked"); } },
    });
    expect(res).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("store is locked"));
  });
});

describe("composeTask", () => {
  it("puts what it was given first and the task last", () => {
    expect(composeTask("do it", ["## Card HU-1", "## RAG"])).toBe("## Card HU-1\n\n## RAG\n\n## Task\n\ndo it");
  });

  it("drops the empties, and with nothing to add leaves the task untouched", () => {
    expect(composeTask("do it", [null, "## Card HU-1", undefined])).toBe("## Card HU-1\n\n## Task\n\ndo it");
    expect(composeTask("do it", [])).toBe("do it");
    expect(composeTask("do it")).toBe("do it");
  });
});
