/**
 * Enrichment (ADR 0021, decision 9): atril writes what it discovers under the
 * artifact's `atril:` key and touches nothing else. Only that block of the raw
 * frontmatter text is replaced, so the author's text and the body survive byte
 * for byte. Extraction is deterministic: same input, same keywords.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import yaml from "js-yaml";
import { assertGraph } from "./graph.js";
import { FRONTMATTER, KINDS } from "./model.js";
import { keyOf, resolveRoot, scan, scanStore } from "./scan.js";
import { fold } from "./text.js";

const MAX_KEYWORDS = 20;
const STOPWORDS = new Set(
  "a an and are as at be by for from how if in into is it its of on or that the this to use when with you your".split(" "),
);
const FENCED_CODE = /^(`{3,}|~{3,})[\s\S]*?^\1/gm;
const HEADING = /^#{1,6}[ \t]+(.+)$/gm;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}-]*/gu;

/** Lowercase words of the description and the Markdown headings, sorted and capped. */
export function extractKeywords(description, body) {
  const headings = [...body.replace(FENCED_CODE, "").matchAll(HEADING)].map((match) => match[1]);
  const words = fold([description, ...headings].join(" ")).match(WORD) ?? [];
  const keywords = new Set(words.filter((word) => word.length > 1 && !STOPWORDS.has(word)));
  return [...keywords].toSorted().slice(0, MAX_KEYWORDS);
}

// How a body names another artifact: a pattern with a `name` group and maybe a
// `kind` group (used when it is a kind: `plugin:name` matches every kind), the
// kind it implies, and whether it launches a subagent.
const mention = (source, kind, launch = false, flags = "g") => [
  new RegExp(source.replace("NAME", "(?<name>[a-z0-9][a-z0-9._-]*)"), flags), kind, launch,
];
const MENTIONS = [
  mention(String.raw`(?:^|[\s(\x60"'])/NAME(?![\w/])`, "command", false, "gm"),
  mention(String.raw`\b(?<kind>[a-z0-9][a-z0-9_-]*):NAME`),
  mention(String.raw`subagent_type["']?\s*[:=]\s*["']?NAME`, "agent", true),
  mention(String.raw`(?:^|[^\w.@])@NAME`, "agent", true, "gm"),
  mention(String.raw`\bskills/NAME/SKILL\.md`, "skill"),
  mention(String.raw`\bcommands/NAME\.md`, "command"),
  mention(String.raw`\bagents/NAME\.md`, "agent"),
  mention(String.raw`\buse the NAME (?<kind>skill|command|agent)\b`, null, false, "gi"),
];

/**
 * Relations the body proposes to other artifacts of the scan: a skill named by a
 * command or agent is `uses`, a launched agent `delegates`, anything else
 * `related`. The author's relations win: a target they already declare is
 * never proposed again.
 * @returns {{ uses?: string[], delegates?: string[], related?: string[] }} sorted, empty lists left out
 */
export function discoverRelations(artifact, artifacts) {
  const known = new Set(artifacts.map(keyOf));
  const taken = new Set([keyOf(artifact), ...artifact.uses, ...artifact.delegates, ...artifact.related]);
  const found = { uses: new Set(), delegates: new Set(), related: new Set() };
  for (const [pattern, kind, launch] of MENTIONS) {
    for (const { groups } of artifact.body.matchAll(pattern)) {
      const named = groups.kind?.toLowerCase();
      const kinds = kind ? [kind] : KINDS.includes(named) ? [named] : KINDS;
      // A trailing dot ends the sentence; it is not part of the slug.
      const name = groups.name.toLowerCase().replace(/\.+$/, "");
      for (const target of kinds.map((k) => `${k}:${name}`)) {
        if (!known.has(target) || taken.has(target)) continue;
        const uses = artifact.kind !== "skill" && target.startsWith("skill:");
        found[uses ? "uses" : launch ? "delegates" : "related"].add(target);
      }
    }
  }
  for (const target of found.delegates) found.related.delete(target);
  return Object.fromEntries(
    Object.entries(found).filter(([, targets]) => targets.size).map(([relation, targets]) => [relation, [...targets].toSorted()]),
  );
}

// The author's frontmatter lines minus the top-level `atril:` key and its lines.
// Blank and comment lines inside the block go with it; those right before the
// next top-level key belong to that key and stay.
function withoutAtrilBlock(front) {
  const kept = [];
  let pending = [];
  let inBlock = false;
  for (const line of front.split("\n")) {
    if (/^atril[ \t]*:/.test(line)) inBlock = true;
    else if (inBlock && /^[ \t]*(#.*)?\r?$/.test(line)) pending.push(line);
    else if (inBlock && /^[ \t]/.test(line)) pending = [];
    else {
      kept.push(...pending, line);
      pending = [];
      inBlock = false;
    }
  }
  return [...kept, ...pending].join("\n");
}

const withoutAtril = ({ atril: _atril, ...author }) => author;

function rewrite(path, atril) {
  const raw = readFileSync(path, "utf8");
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = raw.slice(bom.length);
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error(`${path}: no frontmatter (--- … --- lines at the top)`);
  const front = match[1];
  const eol = front.includes("\r\n") ? "\r\n" : "\n";
  const block = yaml.dump({ atril }, { flowLevel: 2, lineWidth: -1 }).trimEnd().replaceAll("\n", eol);
  const newFront = `${withoutAtrilBlock(front)}${eol}${block}`;
  if (!isDeepStrictEqual(withoutAtril(yaml.load(newFront)), withoutAtril(yaml.load(front)))) {
    throw new Error(`${path}: rewriting atril: would change the author's frontmatter; edit it by hand`);
  }
  const start = text.indexOf("\n") + 1;
  writeFileSync(path, `${bom}${text.slice(0, start)}${newFront}${text.slice(start + front.length)}`);
}

/**
 * Enrich the project store's artifacts, or with `check` only report them
 * (and fail on a graph error).
 * @param {{ projectDir?: string, root?: string, env?: object, check?: boolean }} [opts]
 * @returns {{ path: string, state: "not enriched" | "out of date" }[]} what was (or would be) rewritten
 */
export function enrich({ projectDir = process.cwd(), root, env = process.env, check = false } = {}) {
  const stale = [];
  const artifacts = scanStore(resolve(projectDir, resolveRoot({ root, env })));
  if (check) assertGraph(scan({ projectDir, root, env }).artifacts);
  for (const artifact of artifacts) {
    const { uses: _u, delegates: _d, related: _r, ...kept } = artifact.atril;
    const relations = discoverRelations(artifact, artifacts);
    const atril = { ...kept, ...relations, keywords: extractKeywords(artifact.description, artifact.body), hash: artifact.hash };
    if (isDeepStrictEqual(atril, artifact.atril)) continue;
    stale.push({ path: artifact.path, state: artifact.atril.hash ? "out of date" : "not enriched" });
    if (!check) rewrite(artifact.path, atril);
  }
  return stale;
}
