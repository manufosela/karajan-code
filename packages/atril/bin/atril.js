#!/usr/bin/env node
import { parseArgs } from "node:util";
import { VERSION, resolve } from "../src/index.js";
import { relative } from "node:path";
import { enrich } from "../src/enrich.js";
import { graph } from "../src/graph.js";
import { SEARCH_HINT, looksNonEnglish } from "../src/lang.js";
import { keyOf, scan } from "../src/scan.js";
import { SEARCH_MODE, search } from "../src/search.js";
import { install, remove } from "../src/store.js";
import { generate } from "../src/generate.js";
import { readConfig } from "../src/config.js";
import { expose, unexpose } from "../src/bridge.js";
import { sync } from "../src/sync.js";
import { blockPaths } from "../src/resolve.js";
import { serve } from "../src/mcp.js";
import { catalogSync } from "../src/fetch.js";
import { applyCatalogUpdate, catalogUpdates } from "../src/update.js";
import { installFromCatalog, isCatalogRef } from "../src/catalog-install.js";
import { importSkills } from "../src/import.js";
import { status } from "../src/status.js";
import { createInterface } from "node:readline/promises";
import { applyRecommended, recommended } from "../src/recommended.js";
import { answersFor, askAnswers, offered } from "../src/init.js";
import { applyInstalledUpdate, installedUpdates } from "../src/upgrade.js";
import { installPlugin } from "../src/plugin-install.js";
import { installConfirm, notInstalledLines } from "../src/plugin-install-cli.js";

const USAGE = "Usage: atril --version\n       atril scan [--root <dir>] [--json]\n"
  + "       atril enrich [--root <dir>] [--check]\n       atril graph [<kind:name>] [--root <dir>] [--json]\n"
  + "       atril search <query> [--kind <kind>] [--root <dir>] [--json]\n"
  + "       atril route <task> [--role <role>] [--root <dir>] [--json]\n"
  + "       atril install <path | kind:name> [--kind <kind>] [--root <dir>]\n       atril remove <kind:name> [--root <dir>]\n"
  + "       atril install plugin:<name> [--yes] [--root <dir>] [--json]  (no terminal and no --yes: dry run)\n"
  + "       atril config [--root <dir>] [--json]\n"
  + "       atril expose <kind:name>... [--root <dir>]\n       atril unexpose <kind:name>... [--root <dir>]\n"
  + "       atril sync [--check] [--root <dir>]\n       atril mcp [--root <dir>]\n"
  + "       atril catalog sync [--root <dir>]\n       atril catalog update [--apply] [--root <dir>]\n"
  + "       atril import --from openskills [--root <dir>]\n       atril recommended [--root <dir>] [--json]\n"
  + "       atril status [--check] [--root <dir>] [--json]\n"
  + "       atril init [--yes] [--recommended=on-demand|persistent|none] [--root <dir>] [--json]"
  + "  (--recommended wins over --yes)\n"
  + "       atril update [<kind:name>...] [--yes] [--discard-edits] [--root <dir>] [--json]"
  + "  (no terminal and no --yes: dry run)";

function runImport(args) {
  const { values } = parseArgs({ args, options: { from: { type: "string" }, root: { type: "string" } } });
  if (!values.from) throw new Error(`import needs --from\n${USAGE}`);
  const done = importSkills(values.from, { root: values.root });
  if (done.length === 0) console.log(`nothing to import from ${values.from}`);
  for (const { kind, name, from, path } of done) console.log(`imported\t${kind}:${name}\t${from} -> ${path}`);
}

function runCatalogUpdate(values) {
  const updates = catalogUpdates({ root: values.root });
  if (updates.length === 0) console.log("no git sources to check");
  for (const update of updates) {
    console.log(`${update.status}\t${update.source}\t${update.from.slice(0, 12)}..${update.to.slice(0, 12)}\t${update.catalog}`);
    if (update.status !== "outdated") continue;
    console.log(update.diff);
    if (values.apply) console.log(`pinned\t${update.source}@${update.to.slice(0, 12)}\t${applyCatalogUpdate({ root: values.root }, update)}`);
  }
}

function runCatalog(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { root: { type: "string" }, apply: { type: "boolean" } } });
  if (positionals.join(" ") === "update") return runCatalogUpdate(values);
  if (positionals.join(" ") !== "sync") throw new Error(USAGE);
  const done = catalogSync({ root: values.root });
  if (done.length === 0) console.log("no git sources to fetch");
  for (const { status, source, commit, catalog } of done) console.log(`${status}\t${source}@${commit.slice(0, 12)}\t${catalog}`);
}

async function runMcp(args) {
  const { values } = parseArgs({ args, options: { root: { type: "string" } } });
  await serve({ root: values.root });
}

function runSync(args) {
  const { values } = parseArgs({ args, options: { root: { type: "string" }, check: { type: "boolean" } } });
  const changed = sync({ root: values.root, check: values.check }).filter(({ action }) => action !== "unchanged");
  for (const { action, path } of changed) console.log(`${action}\t${path}`);
  if (values.check) {
    if (changed.length > 0) {
      console.error(`atril: ${changed.length} piece(s) out of date: run atril sync`);
      process.exitCode = 1;
    }
    return;
  }
  if (changed.length === 0) console.log("up to date");
  if (generate({ root: values.root })) console.log("rulesync generate: done");
  else console.error("atril: run rulesync generate to reach your agents, or declare rulesync.generate: true in atril.json");
}

function runExpose(command, args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { root: { type: "string" } } });
  if (positionals.length === 0) throw new Error(`${command} takes at least one kind:name\n${USAGE}`);
  const done = (command === "expose" ? expose : unexpose)(positionals, { root: values.root });
  for (const ref of done) console.log(`${command}d\t${ref}`);
}

function runRecommended(args) {
  const { values } = parseArgs({ args, options: { root: { type: "string" }, json: { type: "boolean" } } });
  const entries = recommended({ root: values.root });
  if (values.json) console.log(JSON.stringify(entries, null, 2));
  else if (entries.length === 0) console.log("this version of atril recommends nothing");
  else for (const { state, kind, name, description } of entries) console.log(`${state}\t${kind}:${name}\t${printable(description)}`);
}

async function askInTerminal(entries) {
  if (!process.stdin.isTTY) throw new Error("init needs a terminal to ask: pass --yes or --recommended=on-demand|persistent|none");
  // Questions go to stderr, so --json keeps stdout clean; EOF or Ctrl-C cancel before applying.
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  const cancelled = new AbortController();
  terminal.once("close", () => cancelled.abort());
  try {
    return await askAnswers(entries, (question) => terminal.question(`${printable(question)} `, { signal: cancelled.signal }));
  } catch (err) {
    throw cancelled.signal.aborted ? new Error("init cancelled: nothing applied") : err;
  } finally {
    terminal.close();
  }
}

async function runInit(args) {
  const { values } = parseArgs({
    args, options: { root: { type: "string" }, yes: { type: "boolean" }, recommended: { type: "string" }, json: { type: "boolean" } },
  });
  const entries = recommended({ root: values.root });
  const fresh = offered(entries);
  const answers = answersFor(entries, values) ?? (fresh.length === 0 ? {} : await askInTerminal(entries));
  const applied = applyRecommended(answers, { root: values.root });
  // A changed entry is never offered: init reports it and leaves it as it is.
  const result = { ...applied, changed: [...applied.changed, ...entries.filter(({ state }) => state === "changed").map(keyOf)] };
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (fresh.length === 0) console.log("nothing new to offer from the recommended set");
  for (const [action, keys] of Object.entries(result)) {
    for (const key of keys) console.log(action === "changed" ? `changed\t${key}\tchanged in this version, not touched: run atril update` : `${action}\t${key}`);
  }
  console.log(Object.entries(result).map(([action, keys]) => `${keys.length} ${action}`).join(", "));
}

// One question per artifact, on stderr so --json keeps stdout clean; an edited one says the edit is lost.
async function askUpdates(pending) {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  const cancelled = new AbortController();
  terminal.once("close", () => cancelled.abort());
  try {
    const accepted = [];
    for (const { kind, name, state } of pending) {
      const lost = state === "edited" ? " (your local edit will be lost)" : "";
      const answer = await terminal.question(`update ${printable(`${kind}:${name}`)}?${lost} [y/N] `, { signal: cancelled.signal });
      if (/^y(es)?$/i.test(answer.trim())) accepted.push(`${kind}:${name}`);
    }
    return accepted;
  } catch (err) {
    throw cancelled.signal.aborted ? new Error("update cancelled: nothing applied") : err;
  } finally {
    terminal.close();
  }
}

async function runUpdate(args) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { root: { type: "string" }, yes: { type: "boolean" }, "discard-edits": { type: "boolean" }, json: { type: "boolean" } },
  });
  const opts = { root: values.root };
  const all = installedUpdates(opts);
  const refOf = ({ kind, name }) => `${kind}:${name}`;
  const unknown = positionals.filter((ref) => !all.some((update) => refOf(update) === ref));
  if (unknown.length > 0) throw new Error(`${unknown.join(", ")}: no catalog origin in the lock; nothing to update from`);
  const updates = positionals.length > 0 ? all.filter((update) => positionals.includes(refOf(update))) : all;
  const gone = updates.filter(({ state }) => state === "unavailable").map(refOf);
  if (positionals.length > 0 && gone.length > 0) throw new Error(`${gone.join(", ")}: not offered by its catalog now (atril catalog sync fetches the git sources)`);
  const pending = updates.filter(({ state }) => state === "outdated" || state === "edited");
  if (!values.json) {
    for (const update of pending) console.log(`${update.state}\t${printable(refOf(update))}\t${printable(update.catalog)}\n${update.diff}`);
    if (pending.length === 0) console.log("everything installed from a catalog is up to date");
  }
  let accepted = [];
  if (values.yes) accepted = pending.filter(({ state }) => state === "outdated" || values["discard-edits"]).map(refOf);
  else if (process.stdin.isTTY) accepted = await askUpdates(pending);
  else if (pending.length > 0) console.error("atril: dry run, nothing applied: pass --yes to update (--discard-edits to overwrite local edits)");
  // An accepted edited ref carries its own consent (--yes --discard-edits, or a "y" to the edit warning).
  // One failed apply does not hide the ones that already landed.
  const applied = [];
  for (const ref of accepted) {
    try {
      applyInstalledUpdate(ref, opts, { discardEdits: pending.some((p) => refOf(p) === ref && p.state === "edited") });
      applied.push(ref);
    } catch (err) {
      console.error(`atril: ${printable(ref)}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  if (values.json) {
    console.log(JSON.stringify({ updates, applied }, null, 2));
    return;
  }
  for (const ref of applied) console.log(`updated\t${printable(ref)}`);
  if (values.yes) for (const update of pending.filter((p) => !accepted.includes(refOf(p)))) console.log(`skipped\t${printable(refOf(update))}\tedited locally; pass --discard-edits to overwrite it`);
}

function runConfig(args) {
  const { values } = parseArgs({ args, options: { root: { type: "string" }, json: { type: "boolean" } } });
  const config = readConfig({ root: values.root });
  if (values.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  console.log(`targets\t${config.targets.join(",")}`);
  for (const [kind, names] of Object.entries(config.expose)) console.log(`expose.${kind}\t${names.join(",")}`);
  console.log(`catalogs\t${config.catalogs.join(",")}`);
  console.log(`rulesync.generate\t${config.rulesync.generate}`);
}

async function runInstallPlugin(name, values) {
  const terminal = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stderr }) : undefined;
  const gate = installConfirm({ yes: values.yes, tty: Boolean(terminal), ask: (question) => terminal.question(question), err: (text) => process.stderr.write(text) });
  try {
    const result = await installPlugin(name, { root: values.root }, { confirm: gate.confirm });
    for (const line of result.status === "installed" ? notInstalledLines(result) : []) console.error(printable(line));
    if (values.json) console.log(JSON.stringify(gate.dryRun() ? { ...result, dryRun: true } : result, null, 2));
    else if (result.status === "declined") console.log(`${gate.dryRun() ? "dry run" : "declined"}\tplugin:${printable(name)}\tnothing installed`);
    else console.log(`installed\tplugin:${printable(name)}\t${result.entries.map(printable).join(" ")}`);
  } finally {
    terminal?.close();
  }
}

async function runStore(command, args) {
  const { values, positionals } = parseArgs({ args, options: { root: { type: "string" }, kind: { type: "string" }, yes: { type: "boolean" }, json: { type: "boolean" } }, allowPositionals: true });
  if (positionals.length !== 1) throw new Error(`${command} takes exactly one argument\n${USAGE}`);
  const [ref] = positionals;
  if (command === "install" && ref.startsWith("plugin:")) return runInstallPlugin(ref.slice("plugin:".length), values);
  for (const flag of ["yes", "json"]) if (values[flag]) throw new Error(`--${flag} only applies to install plugin:<name>`);
  if (command === "install" && isCatalogRef(ref)) {
    const { status, kind, name, path, catalog } = installFromCatalog(ref, { root: values.root });
    console.log(`${status}\t${kind}:${name}\t${path}\tfrom ${printable(catalog)}`);
    return;
  }
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

async function runEnrich(args) {
  const { values } = parseArgs({ args, options: { root: { type: "string" }, check: { type: "boolean" } } });
  const stale = await enrich({ root: values.root, check: values.check });
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
  const hint = hits.length === 0 && looksNonEnglish(query) ? SEARCH_HINT : undefined;
  if (values.json) {
    console.log(JSON.stringify({ mode: SEARCH_MODE, hits, ...(hint && { hint }) }, null, 2));
    return;
  }
  console.error(`atril: search mode ${SEARCH_MODE}`);
  if (hint) console.error(`atril: ${hint}`);
  if (hits.length === 0) console.log(`no results for ${JSON.stringify(query)}`);
  for (const hit of hits) console.log(`${hit.score}\t${hit.kind}\t${printable(hit.name)}\t${hit.source}\t${printable(hit.description)}`);
}

const printBlock = (block, indent = "") => {
  for (const item of block) {
    console.log(`${indent}${item.as}\t${printable(item.path)}`);
    if (item.block) printBlock(item.block, `${indent}  `);
  }
};

function runRoute(args) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { role: { type: "string" }, root: { type: "string" }, json: { type: "boolean" } },
  });
  const { block, suggested, left, reason, available, unresolved } = resolve({ task: positionals.join(" "), role: values.role, root: values.root });
  if (values.json) {
    console.log(JSON.stringify({ block: blockPaths(block), suggested, left, available, ...(reason && { reason }), ...(unresolved && { unresolved }) }, null, 2));
    return;
  }
  for (const { ref, variable, reason: why, hint } of unresolved ?? []) {
    console.error(`unresolved\t${printable(ref)}\t\${${variable}}\t${why}${hint ? `; ${printable(hint)}` : ""}`);
  }
  if (reason) {
    console.log(reason);
  } else {
    printBlock(block);
  }
  // Either way, what fits from the catalogs follows.
  for (const { kind, name, catalog } of available) console.log(`available\t${kind}:${name}\tfrom ${printable(catalog)}`);
}

const describeOrigin = (origin) => {
  if (!origin) return "unknown";
  const { origin: kind, catalog, source, commit, from } = origin;
  const pinned = source && `${source}${commit ? `@${commit.slice(0, 12)}` : ""}`;
  return [kind, ...(kind === "catalog" ? [catalog, pinned] : [from])].filter(Boolean).join(" ");
};

function runStatus(args) {
  const { values } = parseArgs({ args, options: { root: { type: "string" }, json: { type: "boolean" }, check: { type: "boolean" } } });
  const rows = status({ root: values.root });
  if (values.json) console.log(JSON.stringify(rows, null, 2));
  else if (rows.length === 0) console.log("nothing installed");
  else {
    for (const { state, kind, name, origin } of rows) console.log(`${state}\t${kind}:${name}\t${printable(describeOrigin(origin))}`);
    const count = (wanted) => rows.filter(({ state }) => state === wanted).length;
    console.log(`${count("ok")} ok, ${count("edited")} edited, ${count("missing")} missing, ${count("uncurated")} uncurated`);
  }
  if (values.check && rows.some(({ state }) => state === "edited" || state === "missing")) process.exitCode = 1;
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "--version" || command === "-v") console.log(VERSION);
  else if (command === "scan") runScan(rest);
  else if (command === "enrich") await runEnrich(rest);
  else if (command === "graph") runGraph(rest);
  else if (command === "search") runSearch(rest);
  else if (command === "route") runRoute(rest);
  else if (command === "install" || command === "remove") await runStore(command, rest);
  else if (command === "config") runConfig(rest);
  else if (command === "expose" || command === "unexpose") runExpose(command, rest);
  else if (command === "sync") runSync(rest);
  else if (command === "mcp") await runMcp(rest);
  else if (command === "catalog") runCatalog(rest);
  else if (command === "import") runImport(rest);
  else if (command === "recommended") runRecommended(rest);
  else if (command === "status") runStatus(rest);
  else if (command === "init") await runInit(rest);
  else if (command === "update") await runUpdate(rest);
  else throw new Error(command ? `unknown command "${command}"\n${USAGE}` : USAGE);
} catch (err) {
  console.error(`atril: ${err.message}`);
  process.exitCode = 1;
}
