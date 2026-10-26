/**
 * The artifact model (ADR 0021, decisions 4 and 9): a skill, command or agent
 * is Markdown with frontmatter. The author declares name, description and
 * kind, and may declare roles, servers and relations; what atril discovers
 * lives apart under `atril:` (merging the two, author first, is the
 * enrichment step's job). The content hash ignores that block, so
 * enrichment never reads as a local edit.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export const KINDS = ["skill", "command", "agent"];
export const RELATIONS = ["uses", "delegates", "related"];
const LISTS = ["roles", "servers", ...RELATIONS];
export const SLUG = /^[a-z0-9][a-z0-9._-]*$/;
const RELATION = new RegExp(`^(${KINDS.join("|")}):${SLUG.source.slice(1)}`);
export const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

export const isMapping = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
// Locale-independent order, so the hash is the same on every machine.
const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
/** JSON.stringify replacer that writes every mapping's keys in sorted order. */
export const sortKeys = (_key, v) => (isMapping(v) ? Object.fromEntries(Object.entries(v).sort(byKey)) : v);
const canonical = (value) => JSON.stringify(value, sortKeys);

function validate(path, front) {
  const fail = (why) => { throw new Error(`${path}: ${why}`); };
  if (!isMapping(front)) fail("frontmatter must be a mapping");
  for (const field of ["name", "description", "kind"]) {
    if (front[field] === undefined) fail(`missing ${field}`);
    if (typeof front[field] !== "string" || !front[field].trim()) fail(`${field} must be a non-empty string`);
  }
  if (!SLUG.test(front.name)) fail(`name "${front.name}" is not a slug (lowercase letters, digits, . _ -)`);
  if (!KINDS.includes(front.kind)) fail(`kind ${JSON.stringify(front.kind)} is not one of ${KINDS.join(", ")}`);
  const checkList = (label, value, isRelation) => {
    if (!Array.isArray(value)) fail(`${label} must be a list`);
    for (const item of value) {
      if (typeof item !== "string" || !item.trim()) fail(`${label} items must be non-empty strings`);
      if (isRelation && !RELATION.test(item)) fail(`${label} item "${item}" must be kind:name with kind one of ${KINDS.join(", ")}`);
    }
  };
  for (const field of LISTS) {
    if (front[field] !== undefined) checkList(field, front[field], RELATIONS.includes(field));
  }
  if (front.atril !== undefined && !isMapping(front.atril)) fail("atril must be a mapping");
  // KJC-TSK-1129: what atril discovered is a relation too, so the graph never meets a malformed one.
  for (const field of RELATIONS) {
    if (front.atril?.[field] !== undefined) checkList(`atril.${field}`, front.atril[field], true);
  }
}

/**
 * Parse and validate one artifact file. Invalid frontmatter fails loudly,
 * naming the file and the field.
 * @param {string} path
 * @param {{ defaultKind?: string }} [opts] the kind of a file that declares none: catalog
 *   sources in OpenSkills' format write a SKILL.md without `kind` (step 11b)
 */
export function parseArtifact(path, { defaultKind } = {}) {
  const match = FRONTMATTER.exec(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  if (!match) throw new Error(`${path}: no frontmatter (--- … --- lines at the top)`);
  let front;
  try {
    front = yaml.load(match[1]) ?? {};
  } catch (err) {
    throw new Error(`${path}: invalid frontmatter (${err.message})`, { cause: err });
  }
  if (defaultKind !== undefined && isMapping(front) && front.kind === undefined) front = { ...front, kind: defaultKind };
  validate(path, front);
  const body = match[2];
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
