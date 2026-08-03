// KJC-TSK-0711 — RAG as a NATIVE tool: env install wires kj-rag-mcp into the
// project's .mcp.json so agents query the RAG because it is their cheapest
// path, not because a text line asked them to.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installProjectMcp } from "../../src/environment/mcp-wiring.js";

let dir;
const mcpPath = () => path.join(dir, ".mcp.json");
const read = () => JSON.parse(fs.readFileSync(mcpPath(), "utf8"));

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-mcpwire-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("installProjectMcp", () => {
  it("creates .mcp.json with the kj-rag server when absent", () => {
    const res = installProjectMcp({ projectDir: dir, logger: { info() {}, warn() {} } });
    expect(res.wired).toBe(true);
    expect(read().mcpServers["kj-rag"].command).toBe("kj-rag-mcp");
  });

  it("preserves existing servers and is idempotent", () => {
    fs.writeFileSync(mcpPath(), JSON.stringify({ mcpServers: { mine: { command: "my-server" } } }));
    installProjectMcp({ projectDir: dir, logger: { info() {}, warn() {} } });
    installProjectMcp({ projectDir: dir, logger: { info() {}, warn() {} } });
    const cfg = read();
    expect(cfg.mcpServers.mine.command).toBe("my-server");
    expect(Object.keys(cfg.mcpServers).filter((k) => JSON.stringify(cfg.mcpServers[k]).includes("kj-rag-mcp"))).toHaveLength(1);
  });

  it("a user entry already pointing at kj-rag-mcp counts as wired — no duplicate key added", () => {
    fs.writeFileSync(mcpPath(), JSON.stringify({ mcpServers: { "my-kj": { command: "kj-rag-mcp" } } }));
    const res = installProjectMcp({ projectDir: dir, logger: { info() {}, warn() {} } });
    expect(res.wired).toBe(true);
    expect(read().mcpServers["kj-rag"]).toBeUndefined();
  });

  it("invalid JSON is left untouched (preserve, never clobber)", () => {
    fs.writeFileSync(mcpPath(), "{ not json");
    const res = installProjectMcp({ projectDir: dir, logger: { info() {}, warn() {} } });
    expect(res.wired).toBe(false);
    expect(fs.readFileSync(mcpPath(), "utf8")).toBe("{ not json");
  });
});
