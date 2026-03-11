import { describe, it, expect, vi, beforeEach } from "vitest";
import { tools } from "../src/mcp/tools.js";

describe("kj_discover MCP tool schema", () => {
  it("is registered in tools list", () => {
    const tool = tools.find((t) => t.name === "kj_discover");
    expect(tool).toBeDefined();
  });

  it("requires task parameter", () => {
    const tool = tools.find((t) => t.name === "kj_discover");
    expect(tool.inputSchema.required).toContain("task");
  });

  it("has mode as optional enum parameter", () => {
    const tool = tools.find((t) => t.name === "kj_discover");
    const modeProp = tool.inputSchema.properties.mode;
    expect(modeProp).toBeDefined();
    expect(modeProp.type).toBe("string");
    expect(modeProp.enum).toContain("gaps");
  });

  it("has context as optional string", () => {
    const tool = tools.find((t) => t.name === "kj_discover");
    expect(tool.inputSchema.properties.context.type).toBe("string");
  });

  it("has pgTask and pgProject as optional strings", () => {
    const tool = tools.find((t) => t.name === "kj_discover");
    expect(tool.inputSchema.properties.pgTask.type).toBe("string");
    expect(tool.inputSchema.properties.pgProject.type).toBe("string");
  });
});

describe("handleDiscoverDirect", () => {
  let handleToolCall;

  beforeEach(async () => {
    vi.resetModules();
  });

  it("returns error when task is missing", async () => {
    // Import fresh to avoid module caching issues
    const mod = await import("../src/mcp/server-handlers.js");
    handleToolCall = mod.handleToolCall;

    const mockServer = {
      sendLoggingMessage: vi.fn(),
      listRoots: vi.fn().mockResolvedValue({ roots: [] })
    };

    const result = await handleToolCall("kj_discover", {}, mockServer);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("task");
  });

  it("validates invalid mode", async () => {
    const mod = await import("../src/mcp/server-handlers.js");
    handleToolCall = mod.handleToolCall;

    const mockServer = {
      sendLoggingMessage: vi.fn(),
      listRoots: vi.fn().mockResolvedValue({ roots: [] })
    };

    const result = await handleToolCall("kj_discover", { task: "test", mode: "invalid_mode" }, mockServer);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("mode");
  });
});
