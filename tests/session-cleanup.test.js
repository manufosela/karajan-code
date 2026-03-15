import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let testSessionRoot;

vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn(() => path.dirname(testSessionRoot)),
  getSessionRoot: vi.fn(() => testSessionRoot)
}));

describe("session-cleanup", () => {
  let tmpDir;
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-session-cleanup-"));
    testSessionRoot = path.join(tmpDir, "sessions");
    await fs.mkdir(testSessionRoot, { recursive: true });

    const { getSessionRoot } = await import("../src/utils/paths.js");
    getSessionRoot.mockReturnValue(testSessionRoot);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createFakeSession(name, daysOld, status = "approved") {
    const dir = path.join(testSessionRoot, name);
    await fs.mkdir(dir, { recursive: true });
    const date = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    const session = { id: name, created_at: date, updated_at: date, status };
    await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(session), "utf8");
    return dir;
  }

  it("removes failed sessions older than 1 day", async () => {
    await createFakeSession("s_failed-old", 2, "failed");
    await createFakeSession("s_failed-fresh", 0.5, "failed");

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    const result = await cleanupExpiredSessions({ logger });

    expect(result.removed).toBe(1);
    const remaining = await fs.readdir(testSessionRoot);
    expect(remaining).toEqual(["s_failed-fresh"]);
  });

  it("removes stopped sessions older than 1 day", async () => {
    await createFakeSession("s_stopped-old", 3, "stopped");

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    const result = await cleanupExpiredSessions({ logger });

    expect(result.removed).toBe(1);
  });

  it("removes stale running sessions older than 1 day", async () => {
    await createFakeSession("s_running-stale", 2, "running");

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    const result = await cleanupExpiredSessions({ logger });

    expect(result.removed).toBe(1);
  });

  it("removes approved sessions older than 7 days", async () => {
    await createFakeSession("s_approved-old", 10, "approved");
    await createFakeSession("s_approved-recent", 3, "approved");

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    const result = await cleanupExpiredSessions({ logger });

    expect(result.removed).toBe(1);
    const remaining = await fs.readdir(testSessionRoot);
    expect(remaining).toEqual(["s_approved-recent"]);
  });

  it("never removes paused sessions", async () => {
    await createFakeSession("s_paused-old", 30, "paused");

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    const result = await cleanupExpiredSessions({ logger });

    expect(result.removed).toBe(0);
  });

  it("handles missing sessions directory gracefully", async () => {
    await fs.rm(testSessionRoot, { recursive: true });

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    const result = await cleanupExpiredSessions({ logger });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("removes orphan dirs without valid session.json older than 1 day", async () => {
    const dir = path.join(testSessionRoot, "s_orphan");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "partial.txt"), "incomplete", "utf8");

    const oldTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await fs.utimes(dir, oldTime, oldTime);

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    const result = await cleanupExpiredSessions({ logger });

    expect(result.removed).toBe(1);
  });

  it("ignores non-session directories", async () => {
    const dir = path.join(testSessionRoot, "not-a-session");
    await fs.mkdir(dir, { recursive: true });

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    const result = await cleanupExpiredSessions({ logger });

    expect(result.removed).toBe(0);
    const remaining = await fs.readdir(testSessionRoot);
    expect(remaining).toContain("not-a-session");
  });

  it("logs info when sessions are cleaned up", async () => {
    await createFakeSession("s_expired1", 3, "failed");
    await createFakeSession("s_expired2", 5, "stopped");

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    await cleanupExpiredSessions({ logger });

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("2 expired session"));
  });

  it("keeps fresh failed sessions (less than 1 day old)", async () => {
    await createFakeSession("s_just-failed", 0.1, "failed");

    const { cleanupExpiredSessions } = await import("../src/session-cleanup.js");
    const result = await cleanupExpiredSessions({ logger });

    expect(result.removed).toBe(0);
  });
});
