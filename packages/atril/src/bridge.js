/**
 * atril's persistent pieces (ADR 0021, decision 10; plan step 8): the bridge command, the router
 * rule and the artifacts exposed in atril.json, each a path under `.rulesync/` plus its content.
 * Writing them is the sync's job (step 9).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { readConfig, writeConfig } from "./config.js";
import { FRONTMATTER, KINDS } from "./model.js";
import { keyOf, scan } from "./scan.js";

export const MARKER = "<!-- atril:managed -->";
const RULESYNC_DIR = { skill: "skills", command: "commands", agent: "subagents" };

/** The marker goes right after the frontmatter, in the file's own newline style. */
const withMarker = (text) => {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error("a persistent piece needs frontmatter");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const head = text.slice(0, text.length - match[2].length);
  return `${head}${head.endsWith("\n") ? "" : eol}${MARKER}${eol}${match[2]}`;
};

const bridgeCommand = () => ({
  path: "commands/atril.md",
  content: withMarker(`---
description: "Run any atril skill, command or agent: /atril <name or task>"
targets: ["*"]
---
Run \`atril route --json "$ARGUMENTS"\` and follow the plan it prints:
read each block's file in order and apply it to the task; run an entry
of kind "subagent" as a subagent. If the route is empty, say so.
`),
});

const routerRule = () => ({
  path: "rules/atril-router.md",
  content: withMarker(`---
root: false
targets: ["*"]
description: "Ask atril which skills, commands and agents fit a task"
globs: ["**/*"]
---
Before starting a task, run \`atril route "<the task>"\` and use what it
returns. Run \`/atril <name>\` to load one artifact on demand.
`),
});

/** A skill brings its whole folder; the marker goes only in SKILL.md. */
function exposedPiece(artifact) {
  const base = RULESYNC_DIR[artifact.kind];
  const own = withMarker(readFileSync(artifact.path, "utf8"));
  if (artifact.kind !== "skill") return [{ path: `${base}/${artifact.name}.md`, content: own }];
  const folder = dirname(artifact.path);
  const files = readdirSync(folder, { recursive: true, withFileTypes: true }).filter((dirent) => dirent.isFile());
  return files.map((dirent) => join(dirent.parentPath, dirent.name)).toSorted().map((file) => {
    const rel = relative(folder, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    return { path: `${base}/${artifact.name}/${rel}`, content: rel === "SKILL.md" ? withMarker(text) : text };
  });
}

/** @param {{ projectDir?: string, root?: string, userRoot?: string, env?: object }} [opts] */
export function persistentPieces(opts) {
  const { expose } = readConfig(opts);
  const byKey = new Map(scan(opts).artifacts.map((artifact) => [keyOf(artifact), artifact]));
  const pieces = [bridgeCommand(), routerRule()];
  for (const kind of KINDS) {
    for (const name of expose[kind]) {
      const key = `${kind}:${name}`;
      if (key === RESERVED) throw new Error(`atril.json exposes ${key}, reserved for the bridge: atril unexpose ${key}`);
      if (!byKey.has(key)) throw new Error(`atril.json exposes ${key}, which is not in the store: atril unexpose ${key}`);
      pieces.push(...exposedPiece(byKey.get(key)));
    }
  }
  return pieces;
}

const RESERVED = "command:atril";
const parseRef = (ref) => {
  const [kind, name, extra] = String(ref).split(":");
  if (extra !== undefined || !KINDS.includes(kind) || !name) {
    throw new Error(`"${ref}" is not kind:name (kind one of ${KINDS.join(", ")})`);
  }
  return { kind, name, key: `${kind}:${name}` };
};

/** Record the refs in atril.json's expose, each checked against the store. Returns the refs. */
export function expose(refs, opts) {
  const parsed = refs.map(parseRef);
  const held = new Set(scan(opts).artifacts.map(keyOf));
  for (const { key } of parsed) {
    if (key === RESERVED) throw new Error(`${key} is reserved for the bridge`);
    if (!held.has(key)) throw new Error(`${key} is not in the store`);
  }
  const config = readConfig(opts);
  for (const { kind, name } of parsed) if (!config.expose[kind].includes(name)) config.expose[kind].push(name);
  writeConfig(config, opts);
  return parsed.map(({ key }) => key);
}

/** Take the refs out of expose, unchecked on purpose: a removed artifact must stay retractable. */
export function unexpose(refs, opts) {
  const parsed = refs.map(parseRef);
  const config = readConfig(opts);
  for (const { kind, name } of parsed) config.expose[kind] = config.expose[kind].filter((item) => item !== name);
  writeConfig(config, opts);
  return parsed.map(({ key }) => key);
}
