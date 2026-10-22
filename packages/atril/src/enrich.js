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
import { FRONTMATTER } from "./model.js";
import { resolveRoot, scanStore } from "./scan.js";

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
  const words = [description, ...headings].join(" ").toLowerCase().match(WORD) ?? [];
  const keywords = new Set(words.filter((word) => word.length > 1 && !STOPWORDS.has(word)));
  return [...keywords].toSorted().slice(0, MAX_KEYWORDS);
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
 * Enrich the project store's artifacts, or with `check` only report them.
 * @param {{ projectDir?: string, root?: string, env?: object, check?: boolean }} [opts]
 * @returns {{ path: string, state: "not enriched" | "out of date" }[]} what was (or would be) rewritten
 */
export function enrich({ projectDir = process.cwd(), root, env = process.env, check = false } = {}) {
  const stale = [];
  for (const artifact of scanStore(resolve(projectDir, resolveRoot({ root, env })))) {
    const atril = { ...artifact.atril, keywords: extractKeywords(artifact.description, artifact.body), hash: artifact.hash };
    if (isDeepStrictEqual(atril, artifact.atril)) continue;
    stale.push({ path: artifact.path, state: artifact.atril.hash ? "out of date" : "not enriched" });
    if (!check) rewrite(artifact.path, atril);
  }
  return stale;
}
