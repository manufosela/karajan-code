// ADR 0021, plan step 14: atril mcp serves the store's search, resolve, install and remove.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, TOOLS } from "../src/mcp.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-mcp-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const command = (name, description) => `---\nname: ${name}\ndescription: ${description}\nkind: command\n---\nbody\n`;
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const call = (name, args) => {
  const res = callTool(name, args, o());
  return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
};

describe("atril mcp tools", () => {
  it("are search, resolve, install and remove, each with an object input schema", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual(["search", "resolve", "install", "remove"]);
    for (const tool of TOOLS) expect(tool.inputSchema.type).toBe("object");
  });

  it("install, search, resolve and remove as the API does", () => {
    put("incoming/review.md", command("review", "review a pull request"));
    expect(call("install", { path: "incoming/review.md" })).toMatchObject({ kind: "command", name: "review", status: "installed" });
    expect(call("search", { query: "pull request" }).hits.map((hit) => hit.name)).toEqual(["review"]);
    const { block } = call("resolve", { task: "review a pull request" });
    expect(block).toEqual([expect.objectContaining({ name: "review", path: join(dir, "store", "commands", "review.md") })]);
    expect(block[0]).not.toHaveProperty("body");
    expect(call("remove", { kind: "command", name: "review" })).toMatchObject({ name: "review" });
  });

  it("return a bad call as an error, never a crash", () => {
    expect(call("search", {}).error).toBe("atril: query must be a non-empty string");
    expect(call("remove", { kind: "command", name: "ghost" }).error).toMatch(/command:ghost is not installed/);
    expect(call("status", {}).error).toBe('atril: unknown tool "status"');
  });

  it("are served over stdio by atril mcp", async () => {
    put("store/commands/review.md", command("review", "review a pull request"));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BIN, "mcp", "--root", "store"], cwd: dir,
      env: { ...process.env, ATRIL_USER_ROOT: join(dir, "nu") }, stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("resolve");
      const res = await client.callTool({ name: "search", arguments: { query: "review" } });
      expect(JSON.parse(res.content[0].text).hits[0].name).toBe("review");
    } finally {
      await client.close();
    }
  });
});
