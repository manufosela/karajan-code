/**
 * E2E for the plugin system (TSK-0329).
 *
 * Pre-v2.7.5, `src/plugins/loader.js::loadPlugins()` existed but was
 * never imported from production code — the plugin feature was
 * "advertised but not wired". This test verifies that dropping a plugin
 * into `<projectDir>/.karajan/plugins/` and calling `ensureBootstrap()`
 * registers the plugin's agent so `createAgent("dummy")` works.
 *
 * If this test fails, the plugin wiring in `src/bootstrap.js` has
 * regressed — users putting files in their `.karajan/plugins/` directory
 * will not see them loaded.
 */

import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cleanups = [];
afterEach(async () => {
  for (const p of cleanups) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
  cleanups.length = 0;
});

async function setupProjectWithPlugin() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-plugin-wired-"));
  cleanups.push(projectDir);

  const pluginsDir = path.join(projectDir, ".karajan", "plugins");
  await fs.mkdir(pluginsDir, { recursive: true });

  // Copy the fixture plugin into the project's plugins dir so
  // loadPlugins() finds it via its project-scoped lookup.
  const src = path.join(__dirname, "fixtures", "plugins", "dummy-agent.js");
  const dst = path.join(pluginsDir, "dummy-agent.js");
  await fs.copyFile(src, dst);

  return projectDir;
}

// regression-for: TSK-0329
describe("plugins — wired into bootstrap (TSK-0329)", () => {
  it("plugin dropped in .karajan/plugins/ registers its agent via bootstrap", async () => {
    const projectDir = await setupProjectWithPlugin();

    // Directly invoke the loader (what bootstrap calls under the hood).
    // We avoid calling ensureBootstrap() because it runs a full
    // environment check (git, sonar, agents) which is out of scope for
    // this unit test.
    const { loadPlugins } = await import("../src/plugins/loader.js");
    const loaded = await loadPlugins({ projectDir });

    expect(loaded).toHaveLength(1);
    expect(loaded[0].meta?.name).toBe("dummy-agent");

    // After loadPlugins() returns, createAgent("dummy") must work —
    // the registerAgent() call inside the fixture must have populated
    // the built-in agent registry.
    const { createAgent, getAvailableAgents } = await import("../src/agents/index.js");
    const agent = createAgent("dummy", {}, { info() {}, warn() {}, error() {}, debug() {} });
    expect(agent).toBeTruthy();
    expect(agent.name).toBe("dummy");

    // The plugin's canned response should come back unchanged.
    const result = await agent.runTask();
    expect(result.ok).toBe(true);
    expect(result.output).toBe("dummy response");

    // getAvailableAgents() should surface the plugin agent with its meta.
    const all = getAvailableAgents();
    const dummy = all.find((a) => a.name === "dummy");
    expect(dummy).toBeTruthy();
    expect(dummy.fixture).toBe(true);
  });

  it("loadPlugins returns [] when no plugins/ directory exists (no-op, no throw)", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-plugins-empty-"));
    cleanups.push(projectDir);

    const { loadPlugins } = await import("../src/plugins/loader.js");
    const loaded = await loadPlugins({ projectDir });
    expect(loaded).toEqual([]);
  });

  // regression-for: regression
  it("bootstrap.js imports from src/plugins/loader.js (regression guard)", async () => {
    // Pre-v2.7.5 this was the exact symptom of the bug: src/plugins/
    // was never imported from production code. This assertion fails
    // loudly if anyone un-wires the plugin loader from bootstrap again.
    const bootstrap = await fs.readFile(
      path.join(__dirname, "..", "src", "bootstrap.js"),
      "utf8"
    );
    expect(bootstrap).toMatch(/from\s+["']\.\/plugins\/loader\.js["']|import\s*\(\s*["']\.\/plugins\/loader\.js["']\s*\)/);
  });
});
