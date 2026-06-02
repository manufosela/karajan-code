import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

const KJ = path.resolve(process.cwd(), "bin/kj.js");

function send(child, msg) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        const line = buf.slice(0, nl);
        child.stdout.off("data", onData);
        try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(JSON.stringify(msg) + "\n");
    setTimeout(() => reject(new Error("timeout")), 6000);
  });
}

describe("kj rag mcp subcommand", () => {
  it("starts the same MCP server as the kj-rag-mcp binary", async () => {
    const child = spawn("node", [KJ, "rag", "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    try {
      const res = await send(child, { jsonrpc: "2.0", method: "tools/list", id: 1 });
      const names = res?.result?.tools?.map(t => t.name).sort();
      expect(names).toEqual(["kj_rag_index", "kj_rag_query"]);
    } finally {
      child.kill();
    }
  });

  it("appears in `kj rag --help`", async () => {
    const child = spawn("node", [KJ, "rag", "--help"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    await new Promise((resolve) => child.on("exit", resolve));
    expect(stdout).toMatch(/\bmcp\b/);
    expect(stdout).toMatch(/standalone RAG MCP server/i);
  });
});
