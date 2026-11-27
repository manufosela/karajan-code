/**
 * HU-4997: what kj last wrote in a hook, to tell a hand edit from a stale render.
 * The record is the sealed provenance; without one there is nothing to compare. A block kj refreshed
 * since the seal is also kj's: its digest is noted in this machine's harness state.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { findManagedBlock } from "../utils/managed-markers.js";
import { PROVENANCE_FILE } from "./supervisor-commit.js";

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** What `generation.bodySha256` records per hook: the digest of the managed body kj rendered. */
export const bodyDigest = sha256;

/** The kj:managed block of `hook` in `content`, as lines with its markers; null without one. */
const managedBlock = (content, hook) => {
  const { found, startLine, endLine } = findManagedBlock(content, `hook:${hook}`);
  return found ? content.split("\n").slice(startLine, endLine + 1) : null;
};

const between = (block) => block.slice(1, -1).join("\n");

const WRITTEN_FILE = join(".karajan", "harness", "hooks-written.json");

/** The digest of `hook`'s managed block in `content`, whatever its line endings; null without one. */
const writtenDigest = (content, hook) => {
  const block = managedBlock(content.replaceAll("\r\n", "\n"), hook);
  return block ? bodyDigest(between(block)) : null;
};

/**
 * Note the blocks kj has just written, `{ hook: content }`, over what was noted before. Only where the
 * harness is: creating that directory would tell the pre-commit that a Sentinel is installed.
 */
export function recordWrittenHooks(projectDir, contents) {
  const path = join(projectDir, WRITTEN_FILE);
  if (Object.keys(contents).length === 0 || !existsSync(dirname(path))) return;
  const digests = Object.entries(contents).map(([hook, content]) => [hook, writtenDigest(content, hook)]);
  writeFileSync(path, `${JSON.stringify({ ...readJson(path), ...Object.fromEntries(digests) }, null, 2)}\n`);
}

/**
 * A reader of the provenance of `projectDir`: (hook, content) => true when the managed block is not
 * what kj wrote (as sealed, or as last noted), whatever lies outside it and whatever its line endings (core.autocrlf writes \r\n;
 * a seal from before the digests: sealedAs). `render(hook, generation)` is the canonical render,
 * `preamble` what kj puts above the block.
 */
export function handEditDetector(projectDir, render, preamble) {
  const provenance = readJson(join(projectDir, PROVENANCE_FILE));
  const generation = provenance?.generation;
  if (!generation) return () => false;
  const current = readJson(new URL("../../package.json", import.meta.url))?.version;
  // KJC-BUG-0311: this kj cannot re-render another version's template; the sealed bytes say what it wrote.
  const otherKj = provenance.kj_version !== current;
  // A seal without generation.bodySha256 hashed only the whole file: the block is kj's when the file, as is or
  // with \n line endings, is as sealed, or is kj's preamble and this block. Outside lines changed since such a
  // seal that had some still count, until the next seal records the digests.
  const sealedAs = (hook, block, ...files) => {
    const entry = provenance.files?.find((f) => f?.file === `.karajan/hooks/${hook}`);
    return [...files, `${preamble}${block.join("\n")}\n`].some((bytes) => sha256(bytes) === entry?.sha256);
  };
  const written = readJson(join(projectDir, WRITTEN_FILE));
  return (hook, content) => {
    if (written?.[hook] && written[hook] === writtenDigest(content, hook)) return false;
    const lf = content.replaceAll("\r\n", "\n");
    const block = managedBlock(lf, hook);
    if (!block) return true;
    if (between(block) === between(managedBlock(render(hook, generation), hook))) return false;
    const recorded = generation.bodySha256?.[hook];
    if (typeof recorded === "string") return recorded !== bodyDigest(between(block));
    return !(otherKj && sealedAs(hook, block, content, lf));
  };
}
