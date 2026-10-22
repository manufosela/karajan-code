#!/usr/bin/env node
import { parseArgs } from "node:util";
import { VERSION } from "../src/index.js";
import { scan } from "../src/scan.js";
import { SEARCH_MODE, search } from "../src/search.js";

const USAGE = "Usage: atril --version\n       atril scan [--root <dir>] [--json]\n"
  + "       atril search <query> [--kind <kind>] [--root <dir>] [--json]";

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

function runSearch(args) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { kind: { type: "string" }, root: { type: "string" }, json: { type: "boolean" } },
  });
  const query = positionals.join(" ");
  const hits = search(query, { kind: values.kind, root: values.root });
  if (values.json) {
    console.log(JSON.stringify({ mode: SEARCH_MODE, hits }, null, 2));
    return;
  }
  console.error(`atril: search mode ${SEARCH_MODE}`);
  if (hits.length === 0) console.log(`no results for ${JSON.stringify(query)}`);
  for (const hit of hits) console.log(`${hit.score}\t${hit.kind}\t${hit.name}\t${hit.source}\t${hit.description}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "--version" || command === "-v") console.log(VERSION);
  else if (command === "scan") runScan(rest);
  else if (command === "search") runSearch(rest);
  else throw new Error(command ? `unknown command "${command}"\n${USAGE}` : USAGE);
} catch (err) {
  console.error(`atril: ${err.message}`);
  process.exitCode = 1;
}
