/**
 * The terminal half of `atril install plugin:<name>` (step 13 P4): the trust listing and the [y/N]
 * go to stderr so --json keeps stdout clean; no terminal and no --yes is a dry run, like `atril update`.
 */
import { formatInventory } from "./plugin-trust.js";

/** @param {{ yes?: boolean, tty: boolean, ask: (question: string) => Promise<string>, err: (text: string) => void }} io */
export function installConfirm({ yes, tty, ask, err }) {
  let dry = false;
  // `members` are the whole install set in install order; a lone plugin prints exactly what it always did.
  const confirm = async (members, { creates } = {}) => {
    const set = members.length > 1;
    if (set) err(`${members.length} plugins will be installed: ${members.map(({ name, mode }) => (mode ? `${name} (${mode})` : name)).join(", ")}\n`);
    for (const { inventory, source, commit } of members) err(formatInventory(inventory, { source, commit }));
    if (creates) err(`atril: the project has no .rulesync/; installing creates it with only ${creates.join(", ")} and the ledger .owners.json (no rulesync init example files)\n`);
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

/** Whether any result wrote or removed `.rulesync/` entries: what decides if `rulesync generate` is due. */
export const wroteEntries = (results) => results.some(({ rulesync, dropped }) => rulesync?.status === "merged" || dropped?.removed.length > 0);

/** The entries an update left in `.rulesync/` because the user edited them, as stderr lines. */
export const keptLines = ({ dropped }) => (dropped?.kept ?? []).map((key) => `atril: kept ${key} in .rulesync/: you edited it since atril wrote it, so it is yours now`);

/** What the plugin brings that this version of atril does not install, as stderr lines; `name` prefixes each one. */
export function notInstalledLines({ plugin, notInstalled: { hooks, mcpServers, bin }, npm, rulesync }, name) {
  const who = name ? `${name}: ` : "";
  const needs = (rulesync?.needs ?? []).map((key) => `atril: ${plugin ?? name ?? "the plugin"} needs \${${key}} in your environment: its MCP server or hook reads it, and atril never writes its value`);
  const absent = rulesync?.status === "absent" ? [`atril: ${who}rulesync is not installed, so the hooks and MCP servers below were left out: install rulesync and run the install again`] : [];
  const sync = rulesync?.rewritten ? [`atril: ${who}its hook and MCP commands point to its copy in the store: commit the store, or the team must reinstall the plugin on each machine with \`atril install plugin:${plugin ?? name ?? "<name>"}\``] : [];
  const fix = (kind) => kind === "plugin" ? "install it with the host CLI, as below" : "fix it in the plugin (one command per hook, no options before the script, or a `./`-free command) and install again";
  const left = (rulesync?.skipped ?? []).map(({ kind, name: entry, reason }) => `atril: ${who}left out ${kind} ${JSON.stringify(entry)}: ${reason}; ${fix(kind)}`);
  const kept = (rulesync?.kept ?? []).map(({ kind, name: entry, path }) => `atril: ${who}left ${kind} ${JSON.stringify(entry)} with ${path} as it is: the plugin does not ship it, so it is the project's`);
  const lossy = (rulesync?.lossy ?? []).map(({ field, where }) => `atril: ${who}the import lost ${field} (${where}): the entry is written, the field does not change what runs`);
  const native = (rulesync?.instructions ?? []).map((line) => `atril: ${who}${line}`);
  return [...absent, ...(rulesync?.created ? ["atril: created .rulesync/ (it did not exist)"] : []), ...(rulesync?.status === "merged" && !rulesync.instructions ? [`atril: ${who}hooks and MCP servers written to .rulesync/`] : []), ...needs, ...sync, ...kept, ...lossy, ...left, ...native, ...[
    ...(hooks.length ? [`${hooks.length} hook(s)`] : []),
    ...(mcpServers.length ? [`${mcpServers.length} MCP server(s): ${mcpServers.map(({ name }) => JSON.stringify(name)).join(" ")}`] : []),
    ...(bin.length ? [`${bin.length} executable(s) in bin/`] : []),
    ...(npm?.status === "unsupported" ? [`npm packages: ${JSON.stringify(npm.reason)}`] : []),
  ].map((line) => `atril: ${name ? `${name}: ` : ""}not installed yet: ${line}`)];
}
