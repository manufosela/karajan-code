/**
 * The terminal half of `atril install plugin:<name>` (step 13 P4): the trust listing and the [y/N]
 * go to stderr so --json keeps stdout clean; no terminal and no --yes is a dry run, like `atril update`.
 */
import { formatInventory } from "./plugin-trust.js";

/** @param {{ yes?: boolean, tty: boolean, ask: (question: string) => Promise<string>, err: (text: string) => void }} io */
export function installConfirm({ yes, tty, ask, err }) {
  let dry = false;
  const confirm = async (inventory, from) => {
    err(formatInventory(inventory, from));
    if (yes) return true;
    if (tty) return /^y(es)?$/i.test((await ask("install this plugin? [y/N] ")).trim());
    dry = true;
    err("atril: dry run, nothing installed: pass --yes to install\n");
    return false;
  };
  return { confirm, dryRun: () => dry };
}

/** What the plugin brings that this version of atril does not install, as stderr lines. */
export function notInstalledLines({ notInstalled: { hooks, mcpServers, bin }, npm }) {
  return [
    ...(hooks.length ? [`${hooks.length} hook(s)`] : []),
    ...(mcpServers.length ? [`${mcpServers.length} MCP server(s): ${mcpServers.map(({ name }) => JSON.stringify(name)).join(" ")}`] : []),
    ...(bin.length ? [`${bin.length} executable(s) in bin/`] : []),
    ...(npm?.status === "unsupported" ? [`npm packages: ${JSON.stringify(npm.reason)}`] : []),
  ].map((line) => `atril: not installed yet: ${line}`);
}
