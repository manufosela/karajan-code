import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/bootstrap.js", () => ({
  ensureBootstrap: vi.fn().mockResolvedValue(undefined)
}));

import { tools } from "../../src/mcp/tools.js";

describe("kj_triage MCP tool schema", () => {
  it("is registered in tools list", () => {
    const tool = tools.find((t) => t.name === "kj_triage");
    expect(tool).toBeDefined();
  });

  it("accepts task or taskFile (either is valid)", () => {
    const tool = tools.find((t) => t.name === "kj_triage");
    expect(tool.inputSchema.required).toBeUndefined();
    expect(tool.inputSchema.properties.task).toBeDefined();
    expect(tool.inputSchema.properties.taskFile).toBeDefined();
  });

  it("has task as string property", () => {
    const tool = tools.find((t) => t.name === "kj_triage");
    expect(tool.inputSchema.properties.task.type).toBe("string");
  });
});

describe("kj_researcher MCP tool schema", () => {
  it("is registered in tools list", () => {
    const tool = tools.find((t) => t.name === "kj_researcher");
    expect(tool).toBeDefined();
  });

  it("accepts task or taskFile (either is valid)", () => {
    const tool = tools.find((t) => t.name === "kj_researcher");
    expect(tool.inputSchema.required).toBeUndefined();
    expect(tool.inputSchema.properties.task).toBeDefined();
    expect(tool.inputSchema.properties.taskFile).toBeDefined();
  });
});

describe("kj_architect MCP tool schema", () => {
  it("is registered in tools list", () => {
    const tool = tools.find((t) => t.name === "kj_architect");
    expect(tool).toBeDefined();
  });

  it("accepts task or taskFile (either is valid)", () => {
    const tool = tools.find((t) => t.name === "kj_architect");
    expect(tool.inputSchema.required).toBeUndefined();
    expect(tool.inputSchema.properties.task).toBeDefined();
    expect(tool.inputSchema.properties.taskFile).toBeDefined();
  });

  it("has context as optional string", () => {
    const tool = tools.find((t) => t.name === "kj_architect");
    expect(tool.inputSchema.properties.context.type).toBe("string");
  });
});

describe("kj_triage handler validation", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns error when task is missing", async () => {
    const mod = await import("../../src/mcp/server-handlers.js");
    const mockServer = { sendLoggingMessage: vi.fn(), listRoots: vi.fn().mockResolvedValue({ roots: [] }) };
    const result = await mod.handleToolCall("kj_triage", {}, mockServer);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("task");
  });
});

describe("kj_researcher handler validation", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns error when task is missing", async () => {
    const mod = await import("../../src/mcp/server-handlers.js");
    const mockServer = { sendLoggingMessage: vi.fn(), listRoots: vi.fn().mockResolvedValue({ roots: [] }) };
    const result = await mod.handleToolCall("kj_researcher", {}, mockServer);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("task");
  });
});

describe("kj_architect handler validation", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns error when task is missing", async () => {
    const mod = await import("../../src/mcp/server-handlers.js");
    const mockServer = { sendLoggingMessage: vi.fn(), listRoots: vi.fn().mockResolvedValue({ roots: [] }) };
    const result = await mod.handleToolCall("kj_architect", {}, mockServer);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("task");
  });
});

describe("MCP tools count", () => {
  it("has 25 tools registered", () => {
    // Expected surface grows as the CLI gains MCP-exposed commands.
    // Post-v2.7.5: +kj_clean (garbage collector dogfood fallout).
    expect(tools).toHaveLength(25);
  });
});
