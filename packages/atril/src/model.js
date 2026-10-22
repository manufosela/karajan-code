/**
 * The artifact model (ADR 0021, decisions 4 and 9): a skill, command or agent
 * is Markdown with frontmatter. The author declares name, description and
 * kind, and may declare roles, servers and relations; what atril discovers
 * lives apart under `atril:`. The content hash ignores that block, so
 * enrichment never reads as a local edit.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export const KINDS = ["skill", "command", "agent"];
const REQUIRED = ["name", "description", "kind"];
const LISTS = ["roles", "servers", "uses", "delegates", "related"];
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

// Key order must not change the hash: serialize objects with sorted keys.
const canonical = (value) => JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
    : v);

/**
 * Parse and validate one artifact file. Invalid frontmatter fails loudly,
 * naming the file and the field.
 * @param {string} path
 */
export function parseArtifact(path) {
  const match = FRONTMATTER.exec(readFileSync(path, "utf8"));
  if (!match) throw new Error(`${path}: no frontmatter (--- … --- at the top)`);
  let front;
  try {
    front = yaml.load(match[1]) ?? {};
  } catch (err) {
    throw new Error(`${path}: invalid frontmatter (${err.message})`, { cause: err });
  }
  const body = match[2];
  for (const field of REQUIRED) {
    if (typeof front[field] !== "string" || !front[field].trim()) throw new Error(`${path}: missing ${field}`);
  }
  if (!KINDS.includes(front.kind)) {
    throw new Error(`${path}: kind "${front.kind}" is not one of ${KINDS.join(", ")}`);
  }
  for (const field of LISTS) {
    if (front[field] !== undefined && !Array.isArray(front[field])) throw new Error(`${path}: ${field} must be a list`);
  }
  const { atril = {}, ...author } = front;
  const hash = `sha256:${createHash("sha256").update(`${canonical(author)}\n${body}`).digest("hex")}`;
  return {
    path,
    name: front.name,
    kind: front.kind,
    description: front.description,
    ...Object.fromEntries(LISTS.map((field) => [field, front[field] ?? []])),
    atril,
    body,
    hash,
  };
}
