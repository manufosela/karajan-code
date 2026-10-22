#!/usr/bin/env node
import { parseArgs } from "node:util";
import { VERSION } from "../src/index.js";
import { scan } from "../src/scan.js";

import { install, remove } from "../src/store.js";

const USAGE = [
  "Usage: atril --version",
  "       atril scan [--root <dir>] [--json]",
  "       atril install <path> [--kind <kind>] [--root <dir>]",
  "       atril remove <kind:name> [--root <dir>]",
].join("\n");

function runStore(command, args) {
  const { values, positionals } = parseArgs({ args, options: { root: { type: "string" }, kind: { type: "string" } }, allowPositionals: true });
  if (positionals.length !== 1) throw new Error(`${command} takes exactly one argument\n${USAGE}`);
  const [ref] = positionals;
  if (command === "install") {
    const { status, kind, name, path } = install(ref, { root: values.root, kind: values.kind });
    console.log(`${status}\t${kind}:${name}\t${path}`);
    return;
  }
  const [kind, name, ...extra] = ref.split(":");
  if (!name || extra.length) throw new Error(`remove takes kind:name, got "${ref}"`);
  console.log(`removed\t${kind}:${name}\t${remove(name, { kind, root: values.root }).path}`);
}

function runScan(args) {
  const { values } = parseArgs({ args, options: { root: { type: "string" }, json: { type: "boolean" } } });
  const result = scan({ root: values.root });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const artifact of result.artifacts) console.log(`${artifact.kind}\t${artifact.name}\t${artifact.path}`);
  for (const shadow of result.shadowed) console.log(`shadowed\t${shadow.kind}:${shadow.name}\t${shadow.path}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "--version" || command === "-v") console.log(VERSION);
  else if (command === "scan") runScan(rest);
  else if (command === "install" || command === "remove") runStore(command, rest);
  else throw new Error(command ? `unknown command "${command}"\n${USAGE}` : USAGE);
} catch (err) {
  console.error(`atril: ${err.message}`);
  process.exitCode = 1;
}
