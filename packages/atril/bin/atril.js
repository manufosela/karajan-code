#!/usr/bin/env node
import { parseArgs } from "node:util";
import { VERSION } from "../src/index.js";
import { relative } from "node:path";
import { enrich } from "../src/enrich.js";
import { graph } from "../src/graph.js";
import { scan } from "../src/scan.js";
import { SEARCH_MODE, search } from "../src/search.js";

const USAGE = "Usage: atril --version\n       atril scan [--root <dir>] [--json]\n"
  + "       atril enrich [--root <dir>] [--check]\n       atril graph [<kind:name>] [--root <dir>] [--json]\n"
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

function runEnrich(args) {
  const { values } = parseArgs({ args, options: { root: { type: "string" }, check: { type: "boolean" } } });
  const stale = enrich({ root: values.root, check: values.check });
  for (const { path, state } of stale) console.log(`${values.check ? state : "enriched"}\t${relative(process.cwd(), path)}`);
  if (values.check && stale.length > 0) process.exitCode = 1;
}

function runGraph(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { root: { type: "string" }, json: { type: "boolean" } } });
  if (positionals.length > 1) throw new Error(USAGE);
  const result = graph({ root: values.root, artifact: positionals[0] });
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else if (result.edges.length === 0) for (const { kind, name } of result.nodes) console.log(`${kind}:${name}`);
  else for (const { from, relation, to } of result.edges) console.log(`${from}\t${relation}\t${to}`);
}

// A description is the artifact author's text: control characters (ANSI escapes included)
// become spaces, so a searched artifact cannot drive the terminal; whitespace collapses.
const printable = (text) => [...text]
  .map((ch) => { const code = ch.codePointAt(0); return code < 32 || (code >= 127 && code < 160) ? " " : ch; })
  .join("").replaceAll(/\s+/g, " ").trim();

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
  for (const hit of hits) console.log(`${hit.score}\t${hit.kind}\t${printable(hit.name)}\t${hit.source}\t${printable(hit.description)}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "--version" || command === "-v") console.log(VERSION);
  else if (command === "scan") runScan(rest);
  else if (command === "enrich") runEnrich(rest);
  else if (command === "graph") runGraph(rest);
  else if (command === "search") runSearch(rest);
  else throw new Error(command ? `unknown command "${command}"\n${USAGE}` : USAGE);
} catch (err) {
  console.error(`atril: ${err.message}`);
  process.exitCode = 1;
}
