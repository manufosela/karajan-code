/**
 * The choice per plugin (ADR 0021, decision 14): skip, split (the default) or native. Native means
 * atril installs nothing and runs no command of the host CLI (ADR 0042 is only proposed): it tells the
 * user what to run. It does not know each CLI's exact command, so it names the source and says so.
 */
import { readConfig, writeConfig } from "./config.js";
import { CLI_MATRIX } from "./plugin-compat.js";

export const pluginMode = (name, opts) => readConfig(opts).pluginMode?.[name] ?? "split";

export function setPluginMode(name, mode, opts) {
  const config = readConfig(opts);
  writeConfig({ ...config, pluginMode: { ...config.pluginMode, [name]: mode } }, opts);
}

/** Lines for the user, one per CLI plus what the choice means; `source` and `catalog` come from findPlugin. */
export function nativeInstructions(name, { source, catalog }) {
  const from = source.repo ?? source.url ?? `the catalog ${catalog}`;
  return [
    ...Object.keys(CLI_MATRIX).map((cli) => `${cli}: install "${name}" from ${from} with ${cli}'s own plugin tool`),
    "atril does not know the exact command of each CLI and runs none: it installs nothing itself",
    "native puts everything in context, for that CLI only",
  ];
}
