#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./tools.js";
import { handleToolCall, responseText, enrichedFailPayload } from "./server-handlers.js";

const server = new Server(
  {
    name: "karajan-mcp",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {},
      logging: {},
      elicitation: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const name = request.params?.name;
  const args = request.params?.arguments || {};

  try {
    const result = await handleToolCall(name, args, server, extra);
    return responseText(result);
  } catch (error) {
    return responseText(enrichedFailPayload(error, name));
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
