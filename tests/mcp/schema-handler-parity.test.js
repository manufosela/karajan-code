// KJC-TSK-0843 — the contract the agent sees in a tool's inputSchema is the
// one the code honours. Twice a parameter was promised and never read
// (KJC-BUG-0175: taskFile in 7 tools, read only by kj_run; KJC-BUG-0176:
// kjHome in 5 tools, ignored by every direct handler). This test crosses
// every declared property with the SOURCE of the path that serves the tool:
// the handler module, the src/mcp modules it imports (normalizers, run-kj,
// guards), the dispatcher itself and, when the handler forwards the whole
// object as `flags`, the orchestrator modules that honour `flags.<p>`.
// A parameter nobody reads fails, named.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { tools } from "../../src/mcp/tools.js";

const MCP_DIR = resolve(import.meta.dirname, "..", "..", "src", "mcp");
const DISPATCHER = join(MCP_DIR, "server-handlers.js");

// Parameters declared today that no handler reads. Every entry needs a card;
// the list is meant to shrink, never to grow in silence.
const KNOWN_ORPHANS = new Set([]);

const read = (file) => readFileSync(file, "utf8");

/** `kj_x: (a, server, extra) => handleY(...)` pairs of the dispatcher. */
function dispatchMap() {
  const map = new Map();
  for (const m of read(DISPATCHER).matchAll(/(kj_\w+):\s*\([^)]*\)\s*=>\s*(handle\w+)\(/g)) map.set(m[1], m[2]);
  return map;
}

/** The module under src/mcp/handlers that exports the handler function. */
function moduleExporting(fn) {
  const dir = join(MCP_DIR, "handlers");
  const re = new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`);
  return readdirSync(dir).map((f) => join(dir, f)).find((f) => re.test(read(f))) ?? null;
}

/** Transitive closure of relative imports, kept inside src/mcp. */
function corpusOf(entry) {
  const seen = new Set();
  const queue = [entry, DISPATCHER];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of read(file).matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const target = resolve(dirname(file), m[1]);
      if (target.startsWith(MCP_DIR)) queue.push(target);
    }
  }
  return [...seen].map(read).join("\n");
}

/** Read as a property (`a.p`, `args?.p`), destructured (`{ p, q } = args`) or named as a key string. */
function readsParam(corpus, name) {
  const p = name.replaceAll("$", "\\$");
  return new RegExp(`\\??\\.${p}\\b`).test(corpus)
    || new RegExp(`\\{[^}]*\\b${p}\\b[^}]*\\}\\s*=`).test(corpus)
    || new RegExp(`["'\`]${p}["'\`]`).test(corpus);
}

/** Every src module outside src/mcp, joined: where `flags.<p>` is honoured downstream. */
let _flagReaders;
function flagReaders() {
  if (_flagReaders !== undefined) return _flagReaders;
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (p !== MCP_DIR) walk(p); } else if (p.endsWith(".js")) files.push(p);
    }
  };
  walk(resolve(MCP_DIR, ".."));
  _flagReaders = files.map(read).join("\n");
  return _flagReaders;
}

/**
 * A handler that hands the WHOLE args object to the orchestrator (`flags: a`)
 * delegates the reading: the parameter counts as consumed only if some module
 * downstream honours `flags.<p>` — a flag nobody reads there is an orphan too.
 */
function consumed(corpus, name) {
  if (readsParam(corpus, name)) return true;
  if (!/flags:\s*a\b/.test(corpus)) return false;
  return new RegExp(`flags\\??\\.${name.replaceAll("$", "\\$")}\\b`).test(flagReaders());
}

describe("MCP schema ↔ handler parity (KJC-TSK-0843)", () => {
  const dispatch = dispatchMap();

  it("every tool of tools.js is dispatched to a handler that exists", () => {
    for (const tool of tools) {
      expect(dispatch.get(tool.name), `${tool.name} has no dispatcher entry`).toBeTruthy();
      expect(moduleExporting(dispatch.get(tool.name)), `${tool.name} → ${dispatch.get(tool.name)} is exported by no handler module`).toBeTruthy();
    }
  });

  it("every declared parameter is read somewhere on the path that serves its tool", () => {
    const orphans = [];
    for (const tool of tools) {
      const module = moduleExporting(dispatch.get(tool.name));
      // No handler = every parameter is an orphan; said here too, not as a TypeError.
      if (!module) { orphans.push(`${tool.name}.* (no handler)`); continue; }
      const corpus = corpusOf(module);
      for (const name of Object.keys(tool.inputSchema?.properties ?? {})) {
        const key = `${tool.name}.${name}`;
        if (!consumed(corpus, name) && !KNOWN_ORPHANS.has(key)) orphans.push(key);
      }
    }
    expect(orphans, `declared in tools.js, read by nobody: ${orphans.join(", ")}`).toEqual([]);
  });

  it("the known-orphan list only names parameters that are still orphans", () => {
    for (const key of KNOWN_ORPHANS) {
      const [toolName, name] = key.split(".");
      const tool = tools.find((t) => t.name === toolName);
      expect(tool?.inputSchema?.properties?.[name], `${key} is no longer declared`).toBeTruthy();
      const module = moduleExporting(dispatch.get(toolName));
      expect(module, `${key}: its tool has no handler`).toBeTruthy();
      expect(consumed(corpusOf(module), name), `${key} is read now — drop it from KNOWN_ORPHANS`).toBe(false);
    }
  });
});
