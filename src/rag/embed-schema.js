/**
 * KJC-TSK-1171 (RAG-B): which embed schema a project's index was built with. The
 * marker lives next to the project's store; an index built before the header (or with
 * no marker at all) is schema 1 and is rebuilt once, bounded, before it serves queries.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { projectDbPath } from "./project-store.js";
import { EMBED_SCHEMA } from "./embed-header.js";

const PRE_HEADER = 1;
const markerPath = (projectDir) => `${projectDbPath(projectDir)}.embed-schema`;

/** The schema the index holds; 1 when nothing was ever recorded (every index before the header). */
export function readEmbedSchema(projectDir) {
  const file = markerPath(projectDir);
  if (!existsSync(file)) return PRE_HEADER;
  const n = Number(readFileSync(file, "utf8").trim());
  if (!Number.isInteger(n) || n < 1) throw new Error(`${file} does not hold an embed schema number`);
  return n;
}

/** Recorded after a full index, never after a partial one: only a complete rebuild carries the schema. */
export function writeEmbedSchema(projectDir, schema = EMBED_SCHEMA) {
  const file = markerPath(projectDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${schema}\n`, "utf8");
}
