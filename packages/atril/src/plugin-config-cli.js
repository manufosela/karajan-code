/**
 * The terminal half of a plugin's user_config (step 13, P8 B3): `atril config plugin:<name>` and the
 * install-time prompt. A sensitive value is read from stdin or a hidden prompt, never from argv, and is
 * never part of a row, a line or an error here: only its key and whether it is set.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { readLock } from "./lock.js";
import { declaredPluginConfig, readPluginConfig, unsetPluginConfig, writePluginConfig } from "./plugin-config.js";
import { pluginPaths } from "./plugin-source.js";
import { resolveRoot } from "./scan.js";

const declared = (name, opts) => {
  const { plugins = {} } = readLock(opts);
  if (!Object.hasOwn(plugins, name)) throw new Error(`plugin:${name} is not installed`);
  return declaredPluginConfig(pluginPaths(resolve(opts.projectDir ?? process.cwd(), resolveRoot(opts)), name, plugins[name].version).dir);
};

/** `[{ key, sensitive, set, value? }]`; `value` only for a key that is not sensitive. */
export function pluginConfigRows(name, opts = {}) {
  const keys = declared(name, opts);
  const values = readPluginConfig(name, { ...opts, keys: keys.map(({ key }) => key) });
  return keys.map(({ key, sensitive }) => ({ key, sensitive, set: values[key] !== undefined, ...(!sensitive && values[key] !== undefined && { value: values[key] }) }));
}

const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
/** The value of a sensitive key: stdin when piped, a prompt that does not echo on a terminal. */
export async function readSecret(key) {
  if (!process.stdin.isTTY) return readFileSync(0, "utf8").replace(/\r?\n$/, "");
  process.stderr.write(`${key} (input hidden): `);
  const terminal = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    return await terminal.question("");
  } finally {
    terminal.close();
    process.stderr.write("\n");
  }
}
async function readLine(question) {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await terminal.question(question)).trim();
  } finally {
    terminal.close();
  }
}

/** `--set KEY=VALUE`, or `--set KEY` for a sensitive key (the value comes from stdin or a hidden prompt). */
export async function setPluginConfig(name, assignment, opts = {}) {
  const at = assignment.indexOf("=");
  const key = at < 0 ? assignment : assignment.slice(0, at);
  const given = at < 0 ? undefined : assignment.slice(at + 1);
  const option = declared(name, opts).find((candidate) => candidate.key === key);
  if (!option) throw new Error(`"${key}" is not declared by plugin ${name}`);
  if (option.sensitive && given !== undefined) throw new Error(`${key} is sensitive: pass --set ${key} and give the value on stdin, not on the command line`);
  if (!option.sensitive && given === undefined) throw new Error(`--set ${key} needs a value: --set ${key}=VALUE`);
  const value = option.sensitive ? await readSecret(key) : given;
  if (value === "") throw new Error(`${key}: no value given`);
  writePluginConfig(name, key, value, { ...opts, sensitive: option.sensitive });
}

export function unsetPluginKey(name, key, opts = {}) {
  if (!declared(name, opts).some((option) => option.key === key)) throw new Error(`"${key}" is not declared by plugin ${name}`);
  unsetPluginConfig(name, key, opts);
}

/** The declared keys with no value after an install. With `prompt`, asks for each one first; a blank answer skips it. */
export async function configureMissing(name, opts = {}, { prompt = false } = {}) {
  const left = [];
  for (const { key, sensitive, set } of pluginConfigRows(name, opts)) {
    if (set) continue;
    const answer = prompt ? (sensitive ? await readSecret(key) : await readLine(`${name}: ${key}: `)) : "";
    if (answer === "") left.push(key);
    else writePluginConfig(name, key, answer, { ...opts, sensitive });
  }
  return left;
}
