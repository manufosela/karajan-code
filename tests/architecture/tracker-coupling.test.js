/**
 * Architecture regression guard — the orchestrator does not import
 * `src/planning-game/*` directly.
 *
 * Pre-v2.7.5 there were 8 `await import("../planning-game/…")` callsites
 * scattered across flow-runner, ci-integration, drivers, and
 * architect-stage. That made "swap the tracker" (GitHub Projects, Jira,
 * Linear) impossible without editing the orchestrator — PG was not an
 * integration, it was hard-wired.
 *
 * TSK-0339 (KJC-PCS-0040) introduced an integrations registry
 * (`src/orchestrator/integrations.js`) and moved every tracker call
 * behind `getIntegration("tracker")?.hookName(...)`. This test fails CI
 * if a future edit reintroduces a direct import of the `planning-game`
 * tree from anywhere under `src/orchestrator/`.
 *
 * Adding a new tracker: write a sibling `src/adapters/<name>/adapter.js`
 * that registers under the same `"tracker"` slot via `registerIntegration`.
 * Zero orchestrator edits required.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ORCHESTRATOR_DIR = path.join(REPO_ROOT, "src", "orchestrator");

function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(p, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

// Matches `from "…planning-game/…"` / `import("…planning-game/…")` / `require("…planning-game/…")`.
const PG_IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'][^"']*planning-game\/[^"']*["']/;

function stripCommentsAndStrings(source) {
  // Block comments (drop JSDoc examples that would otherwise look like imports).
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return out;
}

describe("architecture/tracker-coupling — orchestrator depends only on integrations registry", () => {
  it("no file under src/orchestrator/ imports from src/planning-game/", () => {
    const files = listJsFiles(ORCHESTRATOR_DIR);
    const offenders = [];
    for (const file of files) {
      const text = stripCommentsAndStrings(fs.readFileSync(file, "utf8"));
      const match = text.match(PG_IMPORT_RE);
      if (match) {
        offenders.push({
          file: path.relative(REPO_ROOT, file),
          import: match[0].trim(),
        });
      }
    }
    const msg = offenders
      .map((o) => `  ${o.file}: ${o.import}`)
      .join("\n");
    expect(
      offenders,
      "src/orchestrator/ must not import src/planning-game/ directly.\n" +
      "Route through the integrations registry:\n" +
      "  import { getIntegration } from \"./integrations.js\";\n" +
      "  await getIntegration(\"tracker\")?.hookName?.(...);\n\n" +
      "Offenders:\n" + msg,
    ).toEqual([]);
  });

  it("integrations module exports the documented API", async () => {
    const mod = await import("../../src/orchestrator/integrations.js");
    expect(typeof mod.registerIntegration).toBe("function");
    expect(typeof mod.getIntegration).toBe("function");
    expect(typeof mod.unregisterIntegration).toBe("function");
    expect(typeof mod.listIntegrations).toBe("function");
  });

  it("planning-game adapter exposes the tracker hook surface", async () => {
    const { planningGameAdapter } = await import("../../src/planning-game/pipeline-adapter.js");
    expect(planningGameAdapter.name).toBe("planning-game");
    // All hooks the orchestrator currently calls on the tracker.
    for (const hook of [
      "onSessionStart",
      "onCommit",
      "onSessionApproved",
      "buildHuStoriesFromCard",
      "handleDecomposition",
      "createAdrsFromTradeoffs",
    ]) {
      expect(typeof planningGameAdapter[hook], `missing hook: ${hook}`).toBe("function");
    }
  });
});
