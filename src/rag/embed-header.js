/**
 * KJC-TSK-1171 (RAG-B, ADR 0026): what the embedder reads before a chunk's body.
 * A query by module, class or file name ("the tax module in billing", "session.js")
 * finds nothing in a body that never mentions them; the header puts path, language,
 * parent, symbol and lines into the vector. Only the embedder sees it: the text
 * stored and shown to the agent is the body as it is.
 */
import { extname, relative } from "node:path";

/** Bumped when what the embedder reads changes: an index with an older one must be rebuilt. */
export const EMBED_SCHEMA = 2;

const LANGUAGES = { js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", go: "go", rs: "rust", java: "java", md: "markdown", mdx: "markdown", json: "json", yml: "yaml", yaml: "yaml" };

const languageOf = (metadata, source) => metadata.language ?? LANGUAGES[extname(source).slice(1).toLowerCase()] ?? null;

/** The header line of a chunk, or "" when nothing beyond the path is known and the path is unknown. */
export function embedHeader(metadata = {}, { root = process.cwd() } = {}) {
  const source = metadata.source;
  if (!source) return "";
  const parts = [relative(root, source) || source];
  const language = languageOf(metadata, source);
  if (language) parts.push(language);
  if (metadata.headingPath?.length) parts.push(metadata.headingPath.join(" > "));
  if (metadata.hu_id) parts.push(metadata.title ? `${metadata.hu_id} ${metadata.title}` : metadata.hu_id);
  if (metadata.symbol) parts.push(metadata.parent ? `${metadata.parent}.${metadata.symbol}` : metadata.symbol);
  if (metadata.start_line) parts.push(metadata.end_line && metadata.end_line !== metadata.start_line ? `L${metadata.start_line}-${metadata.end_line}` : `L${metadata.start_line}`);
  return parts.join(" · ");
}

/** The text the embedder reads: header, blank line, body. The body alone when there is no header. */
export function embedText(chunk, opts) {
  const header = embedHeader(chunk.metadata, opts);
  return header ? `${header}\n\n${chunk.text}` : chunk.text;
}
