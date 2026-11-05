// KJC-TSK-1417: the client of the Planning Game's MCP server (the owner's decision: the Planning Game
// is reached only through its MCP). The server is started as the host configures it, so its
// authentication and its transition rules stay the Planning Game's and kj holds no credential.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BoardOfflineError, BoardRejectedError } from "./board-errors.js";

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

/**
 * The MCP server named `server`: the project's .mcp.json, then the host's ~/.claude.json for this
 * project, then its user-level servers.
 * @returns {{command: string, args?: string[], env?: object}}
 */
export function resolveServer({ server, projectDir = process.cwd(), home = os.homedir() }) {
  const host = readJson(path.join(home, ".claude.json"));
  const found = [
    readJson(path.join(projectDir, ".mcp.json"))?.mcpServers?.[server],
    host?.projects?.[projectDir]?.mcpServers?.[server],
    host?.mcpServers?.[server],
  ].find((spec) => typeof spec?.command === "string");
  if (!found) throw new BoardRejectedError(`no MCP server "${server}" in ${projectDir}/.mcp.json or ~/.claude.json: set planning-game.server to the Planning Game's server name`);
  return found;
}

/** Start the server over stdio with the MCP SDK (loaded only when a real server is used). */
async function connectStdio(spec) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({ command: spec.command, args: spec.args ?? [], env: { ...process.env, ...spec.env }, stderr: "ignore" });
  const client = new Client({ name: "kj-board-planning-game", version: "1.0.0" });
  await client.connect(transport);
  return { callTool: (req) => client.callTool(req), close: () => client.close() };
}

/** @returns {{call: (tool: string, args: object) => Promise<any>, close: () => Promise<void>}} */
export function createClient({ spec, connect = connectStdio }) {
  let session;
  const open = () => (session ??= connect(spec).catch((err) => {
    session = undefined;
    throw new BoardOfflineError(`the Planning Game's MCP server did not start: ${err.message}`);
  }));
  return {
    async call(tool, args) {
      const live = await open();
      let res;
      try { res = await live.callTool({ name: tool, arguments: args }); } catch (err) {
        throw new BoardOfflineError(`the Planning Game's MCP server stopped answering ${tool}: ${err.message}`);
      }
      const text = (res?.content ?? []).map((part) => part?.text ?? "").join("");
      if (res?.isError) throw new BoardRejectedError(`Planning Game ${tool}: ${text}`);
      try { return JSON.parse(text); } catch { throw new BoardRejectedError(`Planning Game ${tool} answered with something that is not JSON`); }
    },
    async close() { if (session) await (await session).close(); session = undefined; },
  };
}
