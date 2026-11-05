// KJC-TSK-1417 step 2: the client of the Planning Game's MCP server, started the way the host has
// it configured, so its authentication and rules stay the Planning Game's.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, resolveServer } from "../src/client.js";

let home, project;
const write = (file, doc) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(doc)); };
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-pg-home-"));
  project = fs.mkdtempSync(path.join(os.tmpdir(), "kj-pg-project-"));
});
afterEach(() => { for (const d of [home, project]) fs.rmSync(d, { recursive: true, force: true }); });

describe("resolveServer", () => {
  const spec = { command: "node", args: ["server.js"] };
  it("finds the server in the project's .mcp.json first, then in the host's ~/.claude.json", () => {
    write(path.join(home, ".claude.json"), { mcpServers: { pg: { command: "user" } }, projects: { [project]: { mcpServers: { pg: { command: "project-entry" } } } } });
    expect(resolveServer({ server: "pg", home, projectDir: project }).command).toBe("project-entry");
    write(path.join(project, ".mcp.json"), { mcpServers: { pg: spec } });
    expect(resolveServer({ server: "pg", home, projectDir: project })).toMatchObject(spec);
  });

  it("falls back to the host's user-level servers, and names the server that is nowhere", () => {
    write(path.join(home, ".claude.json"), { mcpServers: { pg: spec } });
    expect(resolveServer({ server: "pg", home, projectDir: project })).toMatchObject(spec);
    expect(() => resolveServer({ server: "nope", home, projectDir: project })).toThrow(/no MCP server "nope"/);
  });
});

describe("createClient", () => {
  const answer = (doc, isError = false) => ({ isError, content: [{ type: "text", text: typeof doc === "string" ? doc : JSON.stringify(doc) }] });
  const fake = (handler) => {
    const seen = [];
    let connects = 0;
    const connect = async () => { connects += 1; return { callTool: async (req) => { seen.push(req); return handler(req); }, close: async () => {} }; };
    return { connect, seen, connects: () => connects };
  };

  it("calls a tool by name and returns its JSON, connecting once", async () => {
    const pg = fake(() => answer({ cardId: "KJC-TSK-1" }));
    const client = createClient({ spec: { command: "x" }, connect: pg.connect });
    expect(await client.call("get_card", { cardId: "KJC-TSK-1" })).toEqual({ cardId: "KJC-TSK-1" });
    await client.call("get_card", { cardId: "KJC-TSK-1" });
    expect(pg.seen[0]).toEqual({ name: "get_card", arguments: { cardId: "KJC-TSK-1" } });
    expect(pg.connects()).toBe(1);
  });

  it("a tool error is a refusal with the Planning Game's reason; a server that does not start is offline", async () => {
    const refused = createClient({ spec: { command: "x" }, connect: fake(() => answer("Cannot move task to In Progress: sprint missing", true)).connect });
    await expect(refused.call("update_card", {})).rejects.toMatchObject({ name: "BoardRejectedError", message: expect.stringMatching(/sprint missing/) });
    const down = createClient({ spec: { command: "x" }, connect: async () => { throw new Error("spawn x ENOENT"); } });
    await expect(down.call("list_cards", {})).rejects.toMatchObject({ name: "BoardOfflineError", message: expect.stringMatching(/ENOENT/) });
  });

  it("a connection lost in the middle of a call is offline too", async () => {
    const client = createClient({ spec: { command: "x" }, connect: fake(() => { throw new Error("Connection closed"); }).connect });
    await expect(client.call("list_cards", {})).rejects.toMatchObject({ name: "BoardOfflineError", message: expect.stringMatching(/Connection closed/) });
  });

  it("an answer that is not JSON is refused, never guessed", async () => {
    const client = createClient({ spec: { command: "x" }, connect: fake(() => answer("not json")).connect });
    await expect(client.call("get_card", {})).rejects.toMatchObject({ name: "BoardRejectedError", message: expect.stringMatching(/not JSON/) });
  });
});
