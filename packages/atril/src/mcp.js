/**
 * atril mcp (ADR 0021, plan step 14): the store's search, resolve, install and remove as MCP tools
 * over stdio. The store is fixed when the server starts (`atril mcp --root <dir>`): a tool call
 * never chooses it. A failed call comes back as an error result; the server stays up.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "./index.js";
import { KINDS } from "./model.js";
import { blockPaths, resolve } from "./resolve.js";
import { SEARCH_MODE, search } from "./search.js";
import { install, remove } from "./store.js";

const kind = { type: "string", enum: KINDS };
const text = (description) => ({ type: "string", description });
const input = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });

export const TOOLS = [
  { name: "search", description: "Search atril's store for skills, commands and agents",
    inputSchema: input({ query: text("what to look for"), kind }, ["query"]) },
  { name: "resolve", description: "The artifacts that fit a task, as the files to read in order",
    inputSchema: input({ task: text("the task at hand"), role: text("the role that will use them") }, ["task"]) },
  { name: "install", description: "Install a local skill folder, command or agent file into the store",
    inputSchema: input({ path: text("the skill folder or .md file"), kind }, ["path"]) },
  { name: "remove", description: "Remove an artifact from the store",
    inputSchema: input({ kind, name: text("the artifact's name") }, ["kind", "name"]) },
];

const string = (args, field, required = false) => {
  if (args[field] === undefined && !required) return undefined;
  if (typeof args[field] !== "string" || !args[field].trim()) throw new Error(`${field} must be a non-empty string`);
  return args[field];
};

const HANDLERS = {
  search: (args, opts) => ({ mode: SEARCH_MODE, hits: search(string(args, "query", true), { ...opts, kind: string(args, "kind") }) }),
  resolve: (args, opts) => {
    const result = resolve({ ...opts, task: string(args, "task", true), role: string(args, "role") });
    return { ...result, block: blockPaths(result.block) };
  },
  install: (args, opts) => install(string(args, "path", true), { ...opts, kind: string(args, "kind") }),
  remove: (args, opts) => remove(string(args, "name", true), { ...opts, kind: string(args, "kind", true) }),
};

/** One tool call: its result as JSON text, or its error as an error result. */
export function callTool(name, args, opts) {
  try {
    if (!Object.hasOwn(HANDLERS, name)) throw new Error(`unknown tool "${name}"`);
    return { content: [{ type: "text", text: JSON.stringify(HANDLERS[name](args ?? {}, opts), null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `atril: ${err.message}` }] };
  }
}

/** @param {{ root?: string, projectDir?: string }} opts the store, fixed for the server's life */
export async function serve(opts) {
  const server = new Server({ name: "atril", version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => callTool(params.name, params.arguments, opts));
  await server.connect(new StdioServerTransport());
}
