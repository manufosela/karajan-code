/**
 * The hooks and MCP servers of a plugin as canonical `.rulesync/` entries (ADR 0041). `rulesync import` runs on a
 * throwaway copy of the plugin, in a throwaway working directory, so it never touches the project's `.rulesync/`
 * nor the cache. A sensitive `user_config` key stays a reference (`${KEY}`): no value is ever read here.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredPluginConfig } from "./plugin-config.js";
import { prepareImport } from "./plugin-normalize.js";
import { defaultRun, runRulesync } from "./rulesync-cli.js";

const readKind = (root, kind) => {
  const name = [`${kind}.jsonc`, `${kind}.json`].find((file) => existsSync(join(root, ".rulesync", file)));
  return name ? JSON.parse(readFileSync(join(root, ".rulesync", name), "utf8")) : undefined;
};

// `${user_config.KEY}` of a sensitive key becomes `${KEY}`; anything else stays as the import produced it.
const referSecrets = (value, keys) => JSON.parse(keys.reduce((text, key) => text.replaceAll(`\${user_config.${key}}`, `\${${key}}`), JSON.stringify(value)));

/**
 * @returns {{ status: "absent" } | { status: "imported", canonical: { mcp?: object, hooks?: object } }} absent: rulesync does not answer
 * @throws when the import itself fails; the temporary directory is removed either way
 */
export function importCanonical(pluginDir, { projectDir }, run = defaultRun) {
  try { runRulesync(["--version"], { projectDir }, run); } catch { return { status: "absent" }; }
  const tmp = mkdtempSync(join(tmpdir(), "atril-import-"));
  try {
    const copy = join(tmp, "plugin");
    cpSync(pluginDir, copy, { recursive: true, filter: (path) => !/[\\/](node_modules|\.git|\.rulesync)$/.test(path) });
    prepareImport(copy);
    runRulesync(["import", "--targets", "claudecode-plugin", "--features", "mcp,hooks", "--output-root", copy], { projectDir, cwd: tmp }, run);
    const secrets = declaredPluginConfig(pluginDir).filter(({ sensitive }) => sensitive).map(({ key }) => key);
    const canonical = {};
    for (const kind of ["mcp", "hooks"]) {
      const doc = readKind(copy, kind);
      if (doc) canonical[kind] = referSecrets(doc, secrets);
    }
    return { status: "imported", canonical };
  } catch (error) {
    throw new Error(`rulesync import failed (${error.message}); nothing was installed`, { cause: error });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
