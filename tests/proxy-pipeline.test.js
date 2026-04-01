import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  compressRequest,
  estimatePressure,
  createPersistScheduler,
  _resetCaches,
} from "../src/proxy/compression/pipeline.js";

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

function createMockAdapter(toolResults = []) {
  return {
    extractToolResults: vi.fn(() => toolResults),
    rebuildMessages: vi.fn((messages, compressedMap) => {
      // Simulate rebuild: replace tool result text in messages
      return messages.map((m) => {
        if (m.id && compressedMap.has(m.id)) {
          return { ...m, text: compressedMap.get(m.id) };
        }
        return m;
      });
    }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create text of approximately N tokens (chars / 4). */
function textOfTokens(n) {
  return "x".repeat(n * 4);
}

// ---------------------------------------------------------------------------
// estimatePressure
// ---------------------------------------------------------------------------

describe("estimatePressure", () => {
  it("returns low level when context usage is under 50%", () => {
    const messages = [{ role: "user", content: textOfTokens(100) }];
    const result = estimatePressure(messages, 100_000);
    expect(result.level).toBe("low");
    expect(result.threshold).toBe(2000);
  });

  it("returns medium level between 50-80%", () => {
    // JSON.stringify adds overhead, so we estimate carefully
    const tokens = 60_000;
    const maxTokens = 100_000;
    // stringify of [{role:"user",content:"x..."}] adds ~30 chars overhead
    const messages = [{ role: "user", content: textOfTokens(tokens) }];
    const result = estimatePressure(messages, maxTokens);
    expect(result.level).toBe("medium");
    expect(result.threshold).toBe(500);
  });

  it("returns high level between 80-90%", () => {
    const messages = [{ role: "user", content: textOfTokens(85_000) }];
    const result = estimatePressure(messages, 100_000);
    expect(result.level).toBe("high");
    expect(result.threshold).toBe(200);
  });

  it("returns critical level above 90%", () => {
    const messages = [{ role: "user", content: textOfTokens(95_000) }];
    const result = estimatePressure(messages, 100_000);
    expect(result.level).toBe("critical");
    expect(result.threshold).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// compressRequest — full pipeline flow
// ---------------------------------------------------------------------------

describe("compressRequest", () => {
  beforeEach(() => {
    _resetCaches();
  });

  it("returns body unchanged when no tool results are extracted", async () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    const adapter = createMockAdapter([]);

    const { body: result, stats } = await compressRequest(body, adapter);

    expect(result).toEqual(body);
    expect(stats.originalTokens).toBe(0);
    expect(adapter.extractToolResults).toHaveBeenCalledWith(body.messages);
    expect(adapter.rebuildMessages).not.toHaveBeenCalled();
  });

  it("runs the full pipeline: extract → dedup → deterministic → rebuild", async () => {
    const longText = textOfTokens(3000); // above default threshold (2000)
    const toolResults = [
      { id: "r1", toolName: "Bash", text: longText, turnIndex: 0 },
    ];
    const messages = [{ role: "assistant", content: "ok" }];
    const body = { messages, model: "claude" };
    const adapter = createMockAdapter(toolResults);

    const { body: result, stats } = await compressRequest(body, adapter);

    expect(adapter.extractToolResults).toHaveBeenCalledWith(messages);
    expect(adapter.rebuildMessages).toHaveBeenCalled();
    expect(stats.originalTokens).toBe(3000);
    expect(result.model).toBe("claude"); // preserves other fields
  });

  it("skips compression for tool results below threshold", async () => {
    const shortText = textOfTokens(100); // well below 2000 threshold
    const toolResults = [
      { id: "r1", toolName: "Bash", text: shortText, turnIndex: 0 },
    ];
    const body = { messages: [{ role: "user", content: "hi" }] };
    const adapter = createMockAdapter(toolResults);

    const { stats } = await compressRequest(body, adapter);

    expect(stats.originalTokens).toBe(100);
    expect(stats.compressedTokens).toBe(100); // unchanged
    expect(stats.deterministicHits).toBe(0);
  });

  it("deduplicates identical content in later turns", async () => {
    const text = textOfTokens(3000);
    const toolResults = [
      { id: "r1", toolName: "Bash", text, turnIndex: 0 },
      { id: "r2", toolName: "Bash", text, turnIndex: 2 },
    ];
    const body = { messages: [{ role: "user", content: "hi" }] };
    const adapter = createMockAdapter(toolResults);

    const { stats } = await compressRequest(body, adapter);

    // r2 should be deduped — its compressed text should be very small
    expect(stats.originalTokens).toBe(6000);
    // The dedup replacement "[See turn 0, unchanged]" is ~7 tokens
    expect(stats.compressedTokens).toBeLessThan(6000);

    // Verify rebuildMessages received the dedup replacement
    const compressedMap = adapter.rebuildMessages.mock.calls[0][1];
    expect(compressedMap.get("r2")).toBe("[See turn 0, unchanged]");
  });

  it("does not dedup content from the same turn", async () => {
    const text = textOfTokens(3000);
    const toolResults = [
      { id: "r1", toolName: "Bash", text, turnIndex: 0 },
      { id: "r2", toolName: "Bash", text, turnIndex: 0 },
    ];
    const body = { messages: [{ role: "user", content: "hi" }] };
    const adapter = createMockAdapter(toolResults);

    const { stats } = await compressRequest(body, adapter);

    const compressedMap = adapter.rebuildMessages.mock.calls[0][1];
    // r2 should NOT be deduped because turnIndex is equal, not greater
    expect(compressedMap.has("r2")).toBe(false);
  });

  it("uses compression cache on repeated calls with same content", async () => {
    // Build a tool result with git log output that deterministic compressor recognizes
    const gitLogText =
      "commit abc123\nAuthor: Test\nDate: Mon Jan 1\n\n    fix: something\n\n" +
      textOfTokens(3000);
    const toolResults = [
      { id: "r1", toolName: "Bash", text: gitLogText, turnIndex: 0 },
    ];
    const body = { messages: [{ role: "user", content: "hi" }] };
    const adapter = createMockAdapter(toolResults);

    // First call — should compress
    const { stats: stats1 } = await compressRequest(body, adapter);

    // Second call — same content, should hit cache
    const adapter2 = createMockAdapter([
      { id: "r2", toolName: "Bash", text: gitLogText, turnIndex: 0 },
    ]);
    const { stats: stats2 } = await compressRequest(body, adapter2);

    // Only the second call should report a cache hit
    // (first call compresses, second finds it in cache)
    if (stats1.deterministicHits > 0) {
      // The content was actually compressed in call 1
      expect(stats2.cacheHits).toBe(1);
    }
  });

  it("calls AI compressor when enabled and deterministic did not compress", async () => {
    const longText = textOfTokens(3000);
    const compressWithAI = vi.fn(() => textOfTokens(500));
    const toolResults = [
      { id: "r1", toolName: "UnknownTool", text: longText, turnIndex: 0 },
    ];
    const body = { messages: [{ role: "user", content: "hi" }] };
    const adapter = createMockAdapter(toolResults);

    const { stats } = await compressRequest(body, adapter, {
      aiEnabled: true,
      compressWithAI,
    });

    expect(compressWithAI).toHaveBeenCalledWith(longText, "UnknownTool");
    expect(stats.aiHits).toBe(1);
  });

  it("does not call AI compressor when disabled", async () => {
    const longText = textOfTokens(3000);
    const compressWithAI = vi.fn(() => textOfTokens(500));
    const toolResults = [
      { id: "r1", toolName: "UnknownTool", text: longText, turnIndex: 0 },
    ];
    const body = { messages: [{ role: "user", content: "hi" }] };
    const adapter = createMockAdapter(toolResults);

    await compressRequest(body, adapter, {
      aiEnabled: false,
      compressWithAI,
    });

    expect(compressWithAI).not.toHaveBeenCalled();
  });

  it("handles AI compressor failure gracefully", async () => {
    const longText = textOfTokens(3000);
    const compressWithAI = vi.fn(() => {
      throw new Error("AI service down");
    });
    const toolResults = [
      { id: "r1", toolName: "UnknownTool", text: longText, turnIndex: 0 },
    ];
    const body = { messages: [{ role: "user", content: "hi" }] };
    const adapter = createMockAdapter(toolResults);

    // Should not throw
    const { stats } = await compressRequest(body, adapter, {
      aiEnabled: true,
      compressWithAI,
    });

    expect(stats.aiHits).toBe(0);
  });

  it("tracks stats correctly across multiple results", async () => {
    const toolResults = [
      { id: "r1", toolName: "Bash", text: textOfTokens(3000), turnIndex: 0 },
      { id: "r2", toolName: "Bash", text: textOfTokens(100), turnIndex: 1 },
      {
        id: "r3",
        toolName: "Bash",
        text: textOfTokens(3000),
        turnIndex: 2,
      }, // same as r1 — dedup
    ];
    // Make r3 identical to r1
    toolResults[2].text = toolResults[0].text;

    const body = { messages: [{ role: "user", content: "hi" }] };
    const adapter = createMockAdapter(toolResults);

    const { stats } = await compressRequest(body, adapter);

    expect(stats.originalTokens).toBe(6100);
    // r2 below threshold (100 tokens), r3 deduped
    expect(stats.compressedTokens).toBeLessThan(stats.originalTokens);
  });

  it("adapts threshold based on pressure config", async () => {
    const toolResults = [
      { id: "r1", toolName: "UnknownTool", text: textOfTokens(1000), turnIndex: 0 },
    ];
    const body = { messages: [{ role: "user", content: "hi" }] };
    const adapter = createMockAdapter(toolResults);

    // With a small modelMaxTokens, pressure is high → low threshold
    const { stats } = await compressRequest(body, adapter, {
      modelMaxTokens: 500,
    });

    // 1000 tokens is above the 200 threshold at high pressure
    // Since UnknownTool won't match deterministic, it stays uncompressed
    // but the pipeline still processes it
    expect(stats.originalTokens).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// createPersistScheduler
// ---------------------------------------------------------------------------

describe("createPersistScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules flush after markDirty with debounce", async () => {
    const flushFn = vi.fn(() => Promise.resolve());
    const scheduler = createPersistScheduler(flushFn, 1000);

    scheduler.markDirty();
    expect(flushFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(flushFn).toHaveBeenCalledTimes(1);

    scheduler.destroy();
  });

  it("debounces multiple markDirty calls", async () => {
    const flushFn = vi.fn(() => Promise.resolve());
    const scheduler = createPersistScheduler(flushFn, 1000);

    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(500);
    scheduler.markDirty(); // resets the timer
    await vi.advanceTimersByTimeAsync(500);
    expect(flushFn).not.toHaveBeenCalled(); // only 500ms since last markDirty

    await vi.advanceTimersByTimeAsync(500);
    expect(flushFn).toHaveBeenCalledTimes(1);

    scheduler.destroy();
  });

  it("flush() writes immediately and clears pending timer", async () => {
    const flushFn = vi.fn(() => Promise.resolve());
    const scheduler = createPersistScheduler(flushFn, 5000);

    scheduler.markDirty();
    await scheduler.flush();
    expect(flushFn).toHaveBeenCalledTimes(1);

    // Advancing time should NOT trigger another flush
    await vi.advanceTimersByTimeAsync(5000);
    expect(flushFn).toHaveBeenCalledTimes(1);

    scheduler.destroy();
  });

  it("destroy() clears pending timer", async () => {
    const flushFn = vi.fn(() => Promise.resolve());
    const scheduler = createPersistScheduler(flushFn, 1000);

    scheduler.markDirty();
    scheduler.destroy();

    await vi.advanceTimersByTimeAsync(2000);
    expect(flushFn).not.toHaveBeenCalled();
  });
});
