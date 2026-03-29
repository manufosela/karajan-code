import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// We need to mock getSessionRoot before importing the handler
const TEST_SESSION_ROOT = path.join(os.tmpdir(), `kj-suggest-test-${Date.now()}`);

vi.mock("../src/utils/paths.js", () => ({
  getSessionRoot: () => TEST_SESSION_ROOT
}));

const { handleSuggestion } = await import("../src/mcp/suggest-handler.js");

async function createTestSession(id, data = {}) {
  const dir = path.join(TEST_SESSION_ROOT, id);
  await fs.mkdir(dir, { recursive: true });
  const session = {
    id,
    status: "running",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    checkpoints: [],
    ...data
  };
  await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(session, null, 2), "utf8");
  return session;
}

async function readTestSession(id) {
  const raw = await fs.readFile(path.join(TEST_SESSION_ROOT, id, "session.json"), "utf8");
  return JSON.parse(raw);
}

describe("kj_suggest", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_SESSION_ROOT, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_SESSION_ROOT, { recursive: true, force: true });
  });

  it("returns rejection when no active session exists", async () => {
    const result = await handleSuggestion({ suggestion: "Consider using a cache here" });

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/no active pipeline session/i);
  });

  it("logs suggestion when active session exists", async () => {
    await createTestSession("s_2026-01-01T00-00-00-000Z");

    const result = await handleSuggestion({ suggestion: "The test coverage seems low" });

    expect(result.accepted).toBe(true);
    expect(result.status).toBe("logged");
    expect(result.sessionId).toBe("s_2026-01-01T00-00-00-000Z");
    expect(result.message).toMatch(/solomon/i);
  });

  it("stores suggestion in session.suggestions array", async () => {
    await createTestSession("s_2026-01-02T00-00-00-000Z");

    await handleSuggestion({
      suggestion: "Add error handling for network failures",
      context: "iteration 3, coder stage"
    });

    const session = await readTestSession("s_2026-01-02T00-00-00-000Z");
    expect(session.suggestions).toHaveLength(1);
    expect(session.suggestions[0].suggestion).toBe("Add error handling for network failures");
    expect(session.suggestions[0].context).toBe("iteration 3, coder stage");
    expect(session.suggestions[0].timestamp).toBeDefined();
  });

  it("accumulates multiple suggestions", async () => {
    await createTestSession("s_2026-01-03T00-00-00-000Z");

    await handleSuggestion({ suggestion: "First observation" });
    await handleSuggestion({ suggestion: "Second observation" });
    await handleSuggestion({ suggestion: "Third observation" });

    const session = await readTestSession("s_2026-01-03T00-00-00-000Z");
    expect(session.suggestions).toHaveLength(3);
    expect(session.suggestions[0].suggestion).toBe("First observation");
    expect(session.suggestions[1].suggestion).toBe("Second observation");
    expect(session.suggestions[2].suggestion).toBe("Third observation");
  });

  it("tool description mentions it cannot override decisions", async () => {
    const { tools } = await import("../src/mcp/tools.js");
    const suggestTool = tools.find(t => t.name === "kj_suggest");

    expect(suggestTool).toBeDefined();
    expect(suggestTool.description).toMatch(/cannot override/i);
  });

  it("rejects empty suggestion text", async () => {
    await createTestSession("s_2026-01-04T00-00-00-000Z");

    const result = await handleSuggestion({ suggestion: "" });

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/required/i);
  });

  it("ignores non-running sessions", async () => {
    await createTestSession("s_2026-01-05T00-00-00-000Z", { status: "completed" });

    const result = await handleSuggestion({ suggestion: "Something" });

    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/no active pipeline session/i);
  });

  it("scopes session lookup by projectDir", async () => {
    await createTestSession("s_2026-01-06T00-00-00-000Z", {
      status: "running",
      projectDir: "/home/user/project-a"
    });

    // Looking for project-b should not find the session for project-a
    const result = await handleSuggestion({
      suggestion: "Something",
      projectDir: "/home/user/project-b"
    });

    expect(result.accepted).toBe(false);
  });
});
