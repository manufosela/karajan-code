#!/usr/bin/env node
import { parseArgs } from "node:util";
import { VERSION } from "../src/index.js";
import { scan } from "../src/scan.js";

const USAGE = "Usage: atril --version\n       atril scan [--root <dir>] [--json]";
const [command, ...rest] = process.argv.slice(2);

if (command === "--version" || command === "-v") {
  console.log(VERSION);
} else if (command === "scan") {
  const { values } = parseArgs({ args: rest, options: { root: { type: "string" }, json: { type: "boolean" } } });
  const result = scan({ root: values.root });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const a of result.artifacts) console.log(`${a.kind}\t${a.name}\t${a.path}`);
    for (const s of result.shadowed) console.log(`shadowed\t${s.kind}:${s.name}\t${s.path}`);
  }
} else {
  console.error(command ? `atril: unknown command "${command}"\n${USAGE}` : USAGE);
  process.exitCode = 1;
}
