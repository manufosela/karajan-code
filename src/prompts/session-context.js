/**
 * What the coder knows before it writes (KJC-TSK-0864).
 *
 * The method's first invariant is "the RAG answers before you assume", and
 * `kj run` honours it through the researcher stage. `kj code` did not: the
 * declared coder started from a sentence and guessed the codebase. So the
 * session asks the index on the coder's behalf and hands it what came back.
 *
 * Retrieval is best-effort and LOUD: an empty or unreachable index warns and
 * the coder works without project context, because blocking here would stop
 * work in a repo that simply has no index yet. What it never does is stay
 * quiet about it.
 */
import { ragQueryCommand } from "../commands/rag.js";

/** Hits to carry and how much of each: the prompt pays for every line. */
const TOP_K = 5;
const EXCERPT = 400;

const label = (hit) =>
  hit.metadata?.symbol || hit.metadata?.hu_id || hit.metadata?.headingPath?.join(" > ") || hit.kind || "block";

/** @returns {string|null} the agent-facing section, or null when there is nothing to say. */
export function ragSection(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return null;
  const lines = [
    "## What the project's RAG index answers about this task",
    "",
    "Retrieved for you, so you do not guess what the codebase does. These are excerpts: open the file before changing it.",
    "",
  ];
  for (const hit of hits) {
    const text = hit.text || "";
    lines.push(`### ${hit.source} · ${label(hit)}`);
    lines.push("```", text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text, "```", "");
  }
  return lines.join("\n");
}

/**
 * @returns {Promise<null|{section: string|null, sources: string[]}>}
 */
export async function resolveRagContext({ task, config, logger, deps = {} }) {
  const run = deps.ragQueryCommand || ragQueryCommand;
  // The index warns on stdout in CLI mode; here the hits are the product, so
  // its narration is swallowed and only OUR verdict reaches the user.
  const quiet = { info: () => {}, warn: () => {}, error: () => {} };
  let hits;
  try {
    hits = await run({ text: task, config, logger: quiet, flags: { topK: TOP_K } });
  } catch (err) {
    logger?.warn?.(`rag context unavailable (${err.message}) — the coder writes without project context`);
    return null;
  }
  if (!hits?.length) {
    logger?.warn?.("the RAG index returned nothing for this task — the coder writes without project context");
    return null;
  }
  const sources = [...new Set(hits.map((h) => h.source))];
  logger?.info?.(`RAG context: ${sources.length} file(s) — ${sources.join(", ")}`);
  return { section: ragSection(hits), sources };
}

/** The task the coder reads: everything it was given, then its own statement. */
export function composeTask(task, sections = []) {
  const kept = sections.filter(Boolean);
  return kept.length ? `${kept.join("\n\n")}\n\n## Task\n\n${task}` : task;
}
