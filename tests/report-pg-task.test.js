import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("report pg_task_id integration", () => {
  let tmpDir;
  let originalGetSessionRoot;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-report-pg-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeSession(sessionId, data) {
    const dir = path.join(tmpDir, sessionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(data), "utf8");
  }

  it("buildReport includes pg_task_id and pg_project_id when present in session", async () => {
    const sessionId = "s_test-pg";
    await writeSession(sessionId, {
      id: sessionId,
      task: "Fix typo",
      status: "approved",
      checkpoints: [],
      pg_task_id: "KJC-TSK-0042",
      pg_project_id: "Karajan Code"
    });

    const { buildReport } = await import("../src/commands/report.js");
    const report = await buildReport(tmpDir, sessionId);

    expect(report.pg_task_id).toBe("KJC-TSK-0042");
    expect(report.pg_project_id).toBe("Karajan Code");
  });

  it("buildReport omits pg fields when not present in session", async () => {
    const sessionId = "s_test-no-pg";
    await writeSession(sessionId, {
      id: sessionId,
      task: "Fix typo",
      status: "approved",
      checkpoints: []
    });

    const { buildReport } = await import("../src/commands/report.js");
    const report = await buildReport(tmpDir, sessionId);

    expect(report.pg_task_id).toBeUndefined();
    expect(report.pg_project_id).toBeUndefined();
  });

  it("findSessionsByPgTask returns matching session IDs", async () => {
    await writeSession("s_session-1", {
      id: "s_session-1",
      task: "Task 1",
      status: "approved",
      checkpoints: [],
      pg_task_id: "KJC-TSK-0042"
    });
    await writeSession("s_session-2", {
      id: "s_session-2",
      task: "Task 2",
      status: "failed",
      checkpoints: [],
      pg_task_id: "KJC-TSK-0042"
    });
    await writeSession("s_session-3", {
      id: "s_session-3",
      task: "Other task",
      status: "approved",
      checkpoints: [],
      pg_task_id: "KJC-TSK-0099"
    });

    const { findSessionsByPgTask } = await import("../src/commands/report.js");
    const matches = await findSessionsByPgTask(tmpDir, "KJC-TSK-0042");

    expect(matches).toHaveLength(2);
    expect(matches).toContain("s_session-1");
    expect(matches).toContain("s_session-2");
    expect(matches).not.toContain("s_session-3");
  });

  it("findSessionsByPgTask returns empty array when no matches", async () => {
    await writeSession("s_session-1", {
      id: "s_session-1",
      task: "Task 1",
      status: "approved",
      checkpoints: []
    });

    const { findSessionsByPgTask } = await import("../src/commands/report.js");
    const matches = await findSessionsByPgTask(tmpDir, "KJC-TSK-9999");

    expect(matches).toEqual([]);
  });
});

describe("orchestrator stores pg fields in session", () => {
  it("session includes pg_task_id and pg_project_id when provided", async () => {
    const { createSession } = await import("../src/session/store.js");

    // We can't easily test the full orchestrator, but we can verify
    // that createSession properly stores the pg fields
    const session = await createSession({
      id: "s_pg-test",
      task: "Test task",
      pg_task_id: "KJC-TSK-0042",
      pg_project_id: "Karajan Code",
      config_snapshot: {},
      checkpoints: []
    });

    expect(session.pg_task_id).toBe("KJC-TSK-0042");
    expect(session.pg_project_id).toBe("Karajan Code");
  });

  it("session does not have pg fields when not provided", async () => {
    const { createSession } = await import("../src/session/store.js");

    const session = await createSession({
      id: "s_no-pg-test",
      task: "Test task",
      config_snapshot: {},
      checkpoints: []
    });

    expect(session.pg_task_id).toBeUndefined();
    expect(session.pg_project_id).toBeUndefined();
  });
});
