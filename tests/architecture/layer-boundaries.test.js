/**
 * Architecture regression guard — enforce layer boundaries.
 *
 * Karajan's layers, top-to-bottom:
 *
 *   cli / mcp        (interfaces — peer layers, independent)
 *        └─ uses: commands/, handlers/
 *   commands/        (CLI command handlers — `kj run`, `kj audit`, ...)
 *   mcp/handlers/    (MCP tool handlers — `kj_run`, `kj_audit`, ...)
 *        └─ both depend on:
 *   orchestrator/    (the pipeline)
 *        └─ depends on:
 *   roles/ agents/ skills/ session/ prompts/ review/ sonar/ ...
 *
 * Rule: **CLI and MCP are peer layers**. Neither may import from the
 * other. Shared concepts (session overrides, preflight state, runtime
 * context) must live at a neutral layer both can depend on, typically
 * `src/session/` or `src/config/`.
 *
 * This invariant was violated in pre-v2.7.5 code: `src/commands/agents.js`
 * did `await import("../mcp/preflight.js")` to stash a session override.
 * Refactored into `src/session/runtime-overrides.js` so both layers
 * depend on a neutral module instead of each other.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_DIR = path.join(REPO_ROOT, "src");

function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(p, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

function findImports(fileText, matchPattern) {
  // Match both `import x from "..."` and `await import("...")` forms.
  // matchPattern is a substring the target path must contain.
  const patterns = [
    new RegExp(`from\\s+["'][^"']*${matchPattern}[^"']*["']`, "g"),
    new RegExp(`import\\s*\\(\\s*["'][^"']*${matchPattern}[^"']*["']\\s*\\)`, "g"),
    new RegExp(`require\\s*\\(\\s*["'][^"']*${matchPattern}[^"']*["']\\s*\\)`, "g"),
  ];
  const hits = [];
  for (const re of patterns) {
    const matches = fileText.match(re) || [];
    hits.push(...matches);
  }
  return hits;
}

describe("architecture/layer-boundaries — CLI and MCP are peer layers", () => {
  it("no file under src/commands/ imports from src/mcp/", () => {
    const files = listJsFiles(path.join(SRC_DIR, "commands"));
    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      const hits = findImports(text, "/mcp/");
      if (hits.length > 0) {
        offenders.push({ file: path.relative(REPO_ROOT, file), imports: hits });
      }
    }
    const msg = offenders
      .map((o) => `  ${o.file}: ${o.imports.join(", ")}`)
      .join("\n");
    expect(
      offenders,
      "src/commands/ must not depend on src/mcp/. Shared concepts go to src/session/ or src/config/:\n" + msg,
    ).toEqual([]);
  });

  it("src/mcp/ → src/commands/ is a known debt, not worse than baseline", () => {
    // Reverse layer violation: MCP handlers import from src/commands/ (setAgent,
    // listAgents, startBoard, undoCommand). This is a design issue separate
    // from TSK-0331 — those shared helpers should live in src/session/ or
    // their own sharable module so BOTH layers depend on the neutral layer.
    //
    // For now, enforce a **budget**: count the current offending files and
    // fail if the count grows. Opening a separate task to drive the count to
    // 0 by extracting the shared helpers.
    const files = listJsFiles(path.join(SRC_DIR, "mcp"));
    const offenders = new Set();
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      if (findImports(text, "/commands/").length > 0) {
        offenders.add(path.relative(REPO_ROOT, file));
      }
    }
    // Baseline at v2.7.4 audit: management-handlers.js only. Any new file
    // dragging a commands/ import is a regression.
    const allowed = new Set(["src/mcp/handlers/management-handlers.js"]);
    const unexpected = [...offenders].filter((f) => !allowed.has(f));
    expect(
      unexpected,
      `New src/mcp/ → src/commands/ imports detected (file-level). Extract the shared logic to src/session/ or another neutral layer:\n${unexpected.join("\n")}`,
    ).toEqual([]);
  });

  it("src/session/runtime-overrides.js exists and exports the expected functions", async () => {
    const mod = await import("../../src/session/runtime-overrides.js");
    expect(typeof mod.getRuntimeOverrides).toBe("function");
    expect(typeof mod.setRuntimeOverride).toBe("function");
    expect(typeof mod.clearRuntimeOverrides).toBe("function");
  });
});
