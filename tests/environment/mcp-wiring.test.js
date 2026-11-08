// KJC-TSK-0711 / HU-3529 — RAG as a NATIVE tool, wired for the PERSON: the
// shared .mcp.json travels with the repo, so kj-rag-mcp goes to the local scope
// of Claude Code (`claude mcp add --scope local`), never into that file.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installProjectMcp } from "../../src/environment/mcp-wiring.js";

let dir, bin, oldPath;
const mcpPath = () => path.join(dir, ".mcp.json");
const read = () => JSON.parse(fs.readFileSync(mcpPath(), "utf8"));
const calls = () => {
  const log = path.join(bin, "calls.log");
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
};
const adds = () => calls().filter((c) => c.startsWith("mcp add"));
const quiet = { info() {}, warn() {} };
const noQmd = { installed: () => false, wiredGlobally: () => false };

// A fake `claude` on PATH: records its arguments. `mcp add` fails with the real
// CLI's text once the name exists; `mcp get` must never be called (exit 99).
const ALREADY = "MCP server kj-rag already exists in local config";
const fakeClaude = () => {
  fs.writeFileSync(path.join(bin, "claude"), [
    "#!/bin/sh",
    `echo "$*" >> "${bin}/calls.log"`,
    `if [ "$2" = "get" ]; then exit 99; fi`,
    `if [ "$2" = "add" ]; then`,
    `  if [ -f "${bin}/exists" ]; then echo "${ALREADY}" >&2; exit 1; fi`,
    `  if [ -f "${bin}/broken" ]; then echo "boom" >&2; exit 1; fi`,
    `  touch "${bin}/exists"`,
    "fi",
  ].join("\n"), { mode: 0o755 });
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-mcpwire-"));
  bin = fs.mkdtempSync(path.join(os.tmpdir(), "kj-fakebin-"));
  oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  fakeClaude();
});
afterEach(() => {
  process.env.PATH = oldPath;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bin, { recursive: true, force: true });
});

describe("installProjectMcp", () => {
  it("wires kj-rag at the local scope and leaves the shared .mcp.json without any kj entry", () => {
    const res = installProjectMcp({ projectDir: dir, logger: quiet, qmd: noQmd });
    expect(res.wired).toBe(true);
    expect(calls()).toContain("mcp add --scope local kj-rag -- kj-rag-mcp");
    expect(fs.existsSync(mcpPath())).toBe(false);
  });

  it("an existing .mcp.json loses only the kj-rag entry; other servers and keys stay", () => {
    const original = { note: "keep", mcpServers: { "kj-rag": { command: "kj-rag-mcp", args: [] }, mine: { command: "my-server" } } };
    fs.writeFileSync(mcpPath(), `${JSON.stringify(original, null, 2)}\n`);
    installProjectMcp({ projectDir: dir, logger: quiet, qmd: noQmd });
    expect(read()).toEqual({ note: "keep", mcpServers: { mine: { command: "my-server" } } });
    // the legacy project entry must not make the local registration look done
    expect(adds()).toHaveLength(1);
  });

  it("an emptied mcpServers leaves the file in place as an empty object", () => {
    fs.writeFileSync(mcpPath(), JSON.stringify({ mcpServers: { "kj-rag": { command: "kj-rag-mcp", args: [] } } }));
    installProjectMcp({ projectDir: dir, logger: quiet, qmd: noQmd });
    expect(read()).toEqual({ mcpServers: {} });
  });

  it("is idempotent: the second run leaves .mcp.json as the first left it", () => {
    fs.writeFileSync(mcpPath(), `${JSON.stringify({ mcpServers: { "kj-rag": { command: "kj-rag-mcp", args: [] }, mine: { command: "my-server" } } }, null, 2)}\n`);
    const opts = { projectDir: dir, logger: quiet, qmd: noQmd };
    installProjectMcp(opts);
    const after1 = fs.readFileSync(mcpPath(), "utf8");
    installProjectMcp(opts);
    expect(fs.readFileSync(mcpPath(), "utf8")).toBe(after1);
  });

  it("without the claude CLI it says so with the exact command and does not touch .mcp.json", () => {
    fs.rmSync(path.join(bin, "claude"));
    const original = JSON.stringify({ mcpServers: { "kj-rag": { command: "kj-rag-mcp", args: [] } } });
    fs.writeFileSync(mcpPath(), original);
    const warns = [];
    process.env.PATH = bin; // nothing else on PATH
    const res = installProjectMcp({ projectDir: dir, logger: { info() {}, warn: (m) => warns.push(m) }, qmd: noQmd });
    expect(res).toMatchObject({ wired: false, reason: "no-claude-cli" });
    expect(warns.join("\n")).toContain("claude mcp add --scope local kj-rag -- kj-rag-mcp");
    expect(fs.readFileSync(mcpPath(), "utf8")).toBe(original);
  });

  it("an already registered kj-rag is reported, never claimed as wired, overwritten or removed", () => {
    fs.writeFileSync(path.join(bin, "exists"), "");
    const legacy = JSON.stringify({ mcpServers: { "kj-rag": { command: "kj-rag-mcp", args: [] } } });
    fs.writeFileSync(mcpPath(), legacy);
    const infos = [], warns = [];
    const res = installProjectMcp({ projectDir: dir, logger: { info: (m) => infos.push(m), warn: (m) => warns.push(m) }, qmd: noQmd });
    expect(res).toEqual({ wired: false, reason: "kj-rag-already-registered" });
    expect(warns.join("\n")).toMatch(/already registered.*did not check.*claude mcp get kj-rag/s);
    expect(infos).toHaveLength(0);
    expect(calls().every((c) => c.startsWith("mcp add"))).toBe(true);
    expect(fs.readFileSync(mcpPath(), "utf8")).toBe(legacy); // restored: nothing wired
  });

  it("a second run says the server is already registered and changes nothing", () => {
    const opts = { projectDir: dir, logger: quiet, qmd: noQmd };
    expect(installProjectMcp(opts).wired).toBe(true);
    expect(installProjectMcp(opts)).toMatchObject({ wired: false, reason: "kj-rag-already-registered" });
    expect(fs.existsSync(mcpPath())).toBe(false);
  });

  it("any other add failure is the manual-command path, not an already-registered claim", () => {
    fs.writeFileSync(path.join(bin, "broken"), "");
    const warns = [];
    const res = installProjectMcp({ projectDir: dir, logger: { info() {}, warn: (m) => warns.push(m) }, qmd: noQmd });
    expect(res).toMatchObject({ wired: false, reason: "claude-mcp-add-failed" });
    expect(warns.join("\n")).toContain("claude mcp add --scope local kj-rag -- kj-rag-mcp");
  });

  it("kj never calls `claude mcp get`", () => {
    installProjectMcp({ projectDir: dir, logger: quiet, qmd: noQmd });
    expect(calls().some((c) => c.includes("get"))).toBe(false);
  });

  it("a user entry already pointing at kj-rag-mcp counts as wired — nothing added anywhere", () => {
    fs.writeFileSync(mcpPath(), JSON.stringify({ mcpServers: { "my-kj": { command: "kj-rag-mcp" } } }));
    const res = installProjectMcp({ projectDir: dir, logger: quiet, qmd: noQmd });
    expect(res.wired).toBe(true);
    expect(read().mcpServers["my-kj"]).toBeDefined();
    expect(adds()).toHaveLength(0);
  });

  it("invalid JSON is left untouched (preserve, never clobber)", () => {
    fs.writeFileSync(mcpPath(), "{ not json");
    const res = installProjectMcp({ projectDir: dir, logger: quiet });
    expect(res.wired).toBe(false);
    expect(fs.readFileSync(mcpPath(), "utf8")).toBe("{ not json");
  });
});

// KJC-TSK-1067: qmd answers questions about the project's documents (docs,
// notes, ADRs, plans) with fewer tokens and a source. kj init already installs
// it and registers the collections; env install now puts it in the agent's toolbox.
describe("installProjectMcp wires qmd", () => {
  it("with qmd installed and not wired anywhere, adds it to the project as qmd mcp", () => {
    const res = installProjectMcp({ projectDir: dir, logger: quiet, qmd: { installed: () => true, wiredGlobally: () => false } });
    expect(read().mcpServers.qmd).toEqual({ command: "qmd", args: ["mcp"] });
    expect(res.qmd).toBe("added");
  });

  it("never twice: not when the user already has it globally or in the project, nor without qmd", () => {
    installProjectMcp({ projectDir: dir, logger: quiet, qmd: { installed: () => true, wiredGlobally: () => true } });
    expect(fs.existsSync(mcpPath())).toBe(false);
    fs.rmSync(path.join(bin, "exists")); // fresh claude state for the next runs
    installProjectMcp({ projectDir: dir, logger: quiet, qmd: noQmd });
    expect(fs.existsSync(mcpPath())).toBe(false);
    fs.rmSync(path.join(bin, "exists"));
    fs.writeFileSync(mcpPath(), JSON.stringify({ mcpServers: { docs: { command: "/usr/bin/qmd", args: ["mcp"] } } }));
    const res = installProjectMcp({ projectDir: dir, logger: quiet, qmd: { installed: () => true, wiredGlobally: () => false } });
    expect(Object.keys(read().mcpServers)).toEqual(["docs"]);
    expect(res.qmd).toBe("present");
  });
});
