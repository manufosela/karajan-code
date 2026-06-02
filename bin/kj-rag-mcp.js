#!/usr/bin/env node
/**
 * kj-rag-mcp — standalone MCP server exposing only RAG tools.
 *
 * For external IDEs (Cursor, Windsurf, Continue, Zed) that want semantic
 * search over a Karajan-indexed project without pulling in the full 27-tool
 * orchestrator surface. Re-uses handleRagQuery / handleRagIndex from the
 * main server, so behavior stays in sync with `karajan-mcp`.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { handleRagQuery, handleRagIndex } from "../src/mcp/handlers/rag-handler.js";
import { responseText, enrichedFailPayload } from "../src/mcp/shared-helpers.js";
import { setupOrphanGuard } from "../src/mcp/orphan-guard.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.resolve(MODULE_DIR, "../package.json");
const VERSION = JSON.parse(readFileSync(PKG_PATH, "utf8")).version;

const RAG_TOOLS = [
  {
    name: "kj_rag_query",
    description: "Semantic search across the indexed Karajan plans, onboarding briefs and (optionally) project source code. Returns the top-K nearest chunks with metadata so the agent can quote prior decisions or locate where a concept was last implemented. Empty until `kj_rag_index` has run at least once.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Natural-language query." },
        topK: { type: "number", description: "Max hits to return. Default 5." },
        scope: { type: "string", description: "'plans' | 'code' | 'onboarding' | 'all' (default)." },
        projectDir: { type: "string", description: "Absolute path to the project directory." }
      },
      required: ["text"]
    }
  },
  {
    name: "kj_rag_index",
    description: "(Re)index this project's Karajan-managed assets into the local vector store. Idempotent. Pass `withSources: true` to also index project source files. Required as a one-time bootstrap before `kj_rag_query` returns anything.",
    inputSchema: {
      type: "object",
      properties: {
        withSources: { type: "boolean", description: "Also index source files under projectDir. Default false." },
        projectDir: { type: "string", description: "Absolute path to the project directory." }
      }
    }
  }
];

const mcpServer = new McpServer(
  { name: "kj-rag-mcp", version: VERSION },
  { capabilities: { tools: {}, logging: {} } }
);
const server = mcpServer.server;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: RAG_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params?.name;
  const args = request.params?.arguments || {};
  try {
    if (name === "kj_rag_query") return responseText(await handleRagQuery(args, server));
    if (name === "kj_rag_index") return responseText(await handleRagIndex(args, server));
    return responseText({ ok: false, error: `Unknown tool: ${name}` });
  } catch (error) {
    return responseText(enrichedFailPayload(error, name));
  }
});

setupOrphanGuard();

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
