/**
 * The terminal half of `atril install plugin:<name>` (step 13 P4): the trust listing and the [y/N]
 * go to stderr so --json keeps stdout clean; no terminal and no --yes is a dry run, like `atril update`.
 */
import { formatInventory } from "./plugin-trust.js";

/** @param {{ yes?: boolean, tty: boolean, ask: (question: string) => Promise<string>, err: (text: string) => void }} io */
export function installConfirm({ yes, tty, ask, err }) {
  let dry = false;
  // `members` are the whole install set in install order; a lone plugin prints exactly what it always did.
  const confirm = async (members) => {
    const set = members.length > 1;
    if (set) err(`${members.length} plugins will be installed: ${members.map(({ name }) => name).join(", ")}\n`);
    for (const { inventory, source, commit } of members) err(formatInventory(inventory, { source, commit }));
    if (yes) return true;
    if (tty) return /^y(es)?$/i.test((await ask(`install ${set ? "these plugins" : "this plugin"}? [y/N] `)).trim());
    dry = true;
    err("atril: dry run, nothing installed: pass --yes to install\n");
    return false;
  };
  return { confirm, dryRun: () => dry };
}

/**
 * The terminal half of `atril update plugin:<name>`: the new inventory, then [y/N]; when what the plugin can run
 * changed, updatePlugin asks again (`again`) and the warning replaces the listing. Same rules as installConfirm.
 * @param {Parameters<typeof installConfirm>[0]} io
 */
export function updateConfirm({ yes, tty, ask, err }) {
  let dry = false;
  const confirm = async (inventory, { source, commit, again }) => {
    err(again ? "atril: the new version's hooks, MCP servers, executables or npm packages differ from the installed one; read the listing above again\n" : formatInventory(inventory, { source, commit }));
    if (yes) return true;
    if (tty) return /^y(es)?$/i.test((await ask(again ? "apply it anyway? [y/N] " : "update this plugin? [y/N] ")).trim());
    dry = true;
    err("atril: dry run, nothing updated: pass --yes to update\n");
    return false;
  };
  return { confirm, dryRun: () => dry };
}

/** What the plugin brings that this version of atril does not install, as stderr lines; `name` prefixes each one. */
export function notInstalledLines({ notInstalled: { hooks, mcpServers, bin }, npm }, name) {
  return [
    ...(hooks.length ? [`${hooks.length} hook(s)`] : []),
    ...(mcpServers.length ? [`${mcpServers.length} MCP server(s): ${mcpServers.map(({ name }) => JSON.stringify(name)).join(" ")}`] : []),
    ...(bin.length ? [`${bin.length} executable(s) in bin/`] : []),
    ...(npm?.status === "unsupported" ? [`npm packages: ${JSON.stringify(npm.reason)}`] : []),
  ].map((line) => `atril: ${name ? `${name}: ` : ""}not installed yet: ${line}`);
}
