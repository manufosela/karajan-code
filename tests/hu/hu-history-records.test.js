import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock getKarajanHome to use a temp directory
let tmpDir;
vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: () => tmpDir
}));

describe("HU history records", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-hu-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("pipeline completion creates a history record in hu/store", async () => {
    const { createHistoryRecord } = await import("../src/hu/store.js");
    const sessionId = "test-session-001";
    const batch = await createHistoryRecord(sessionId, {
      task: "Add login button",
      result: "completed",
      approved: true,
      summary: "Login button added successfully"
    });

    // Verify the file was written
    const filePath = path.join(tmpDir, "hu-stories", sessionId, "batch.json");
    const raw = await fs.readFile(filePath, "utf8");
    const loaded = JSON.parse(raw);

    expect(loaded.session_id).toBe(sessionId);
    expect(loaded.stories).toHaveLength(1);
    expect(loaded.history).toBeDefined();
    expect(batch).toEqual(loaded);
  });

  it("history record contains task, result, approved status, and timestamp", async () => {
    const { createHistoryRecord } = await import("../src/hu/store.js");
    const ts = "2026-03-26T10:00:00.000Z";
    const batch = await createHistoryRecord("sess-002", {
      task: "Fix authentication bug",
      result: "bug fixed",
      approved: true,
      summary: "Auth flow corrected",
      timestamp: ts
    });

    expect(batch.history.task).toBe("Fix authentication bug");
    expect(batch.history.result).toBe("bug fixed");
    expect(batch.history.approved).toBe(true);
    expect(batch.history.timestamp).toBe(ts);
    expect(batch.created_at).toBe(ts);
    expect(batch.stories[0].created_at).toBe(ts);
    expect(batch.stories[0].updated_at).toBe(ts);
  });

  it("failed pipelines also create a history record with approved: false", async () => {
    const { createHistoryRecord } = await import("../src/hu/store.js");
    const batch = await createHistoryRecord("sess-fail-003", {
      task: "Refactor database layer",
      result: "max_iterations reached",
      approved: false,
      summary: "Could not complete within iteration budget"
    });

    expect(batch.history.approved).toBe(false);
    expect(batch.stories[0].status).toBe("failed");
    expect(batch.stories[0].certified).toBeNull();

    // Verify file exists on disk
    const filePath = path.join(tmpDir, "hu-stories", "sess-fail-003", "batch.json");
    const raw = await fs.readFile(filePath, "utf8");
    const loaded = JSON.parse(raw);
    expect(loaded.history.approved).toBe(false);
    expect(loaded.stories[0].status).toBe("failed");
  });

  it("history record format is compatible with HU Board sync (same shape as batch.json)", async () => {
    const { createHistoryRecord, loadHuBatch } = await import("../src/hu/store.js");
    const sessionId = "sess-compat-004";

    await createHistoryRecord(sessionId, {
      task: "Update API endpoint",
      result: "done",
      approved: true,
      summary: "Endpoint updated"
    });

    // loadHuBatch should be able to load the history record
    const loaded = await loadHuBatch(sessionId);
    expect(loaded.session_id).toBe(sessionId);
    expect(loaded.created_at).toBeDefined();
    expect(Array.isArray(loaded.stories)).toBe(true);
    expect(loaded.stories.length).toBeGreaterThan(0);

    // Each story has the same shape as a regular batch story
    const story = loaded.stories[0];
    expect(story).toHaveProperty("id");
    expect(story).toHaveProperty("status");
    expect(story).toHaveProperty("original");
    expect(story.original).toHaveProperty("text");
    expect(story).toHaveProperty("blocked_by");
    expect(Array.isArray(story.blocked_by)).toBe(true);
    expect(story).toHaveProperty("certified");
    expect(story).toHaveProperty("quality");
    expect(story).toHaveProperty("context_requests");
    expect(Array.isArray(story.context_requests)).toBe(true);
    expect(story).toHaveProperty("created_at");
    expect(story).toHaveProperty("updated_at");
  });
});
