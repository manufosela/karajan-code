import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

/**
 * `kj rag mcp` — spawn the standalone RAG MCP server inline.
 *
 * KJC-TSK-0492 PR3. Adds CLI discoverability for the `kj-rag-mcp` binary
 * so external IDE users can find it via the same `kj rag <subcommand>`
 * surface they already know. The implementation dynamic-imports the
 * binary entry so behavior stays identical to running `kj-rag-mcp`
 * directly — same handlers, same transport, same orphan guard.
 */
export async function ragMcpCommand() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const binPath = path.resolve(moduleDir, "../../bin/kj-rag-mcp.js");
  await import(pathToFileURL(binPath).href);
}
