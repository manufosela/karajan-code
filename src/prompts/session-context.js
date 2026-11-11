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
import fs from "node:fs";
import { join } from "node:path";
import { ragQueryCommand } from "../commands/rag.js";
import { loadRecord } from "../link/record.js";
import { readInbox } from "../link/reader.js";

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
 * What to ask the index (KJC-BUG-0540): the task text, plus the card's title and
 * criteria and the review's findings. A retry has no task text, so the card and
 * the findings are the whole question. Empty when there is nothing to ask.
 */
export function ragQueryText({ task, card, review }) {
  const criteria = card?.acceptanceTests?.map((t) => t.content) ?? [];
  const parts = [task, card?.title, ...criteria, ...(review?.findings ?? [])];
  return parts.filter((p) => typeof p === "string" && p.trim()).join("\n").trim();
}

/**
 * @returns {Promise<null|{section: string|null, sources: string[]}>}
 */
export async function resolveRagContext({ task, config, logger, deps = {} }) {
  const run = deps.ragQueryCommand || ragQueryCommand;
  if (!task?.trim()) {
    logger?.warn?.("rag context skipped (nothing to ask the index) — the coder writes without project context");
    return null;
  }
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

/**
 * HU-3803: how an agent learns there is mail. ONE line: the count of unread messages from permitted
 * authors and the command that reads them. A number is the only thing that leaves the reader, so no
 * body, author or subject can reach the prompt. Rejected: injecting the first messages themselves, which
 * would put an untrusted text in front of the agent unasked (ADR 0043: pull only). Reads through
 * readInbox (the permission filter) and never saves a record, so no cursor moves.
 */
const MAIL_TIMEOUT_MS = 3000;

async function unreadIn(projectDir, adapter) {
  const dir = join(projectDir, ".karajan", "link");
  const keys = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .map((file) => /^(issue|pr)-([1-9]\d{0,9})\.json$/.exec(file))
    .filter(Boolean)
    .map(([, kind, digits]) => ({ kind, number: Number(digits) }));
  const counts = await Promise.all(keys.map(async (key) => {
    const thread = { kind: key.kind === "pr" ? "pull_request" : "issue", number: key.number };
    return (await readInbox({ adapter, thread, store: loadRecord(projectDir, key) })).messages.length;
  }));
  return counts.reduce((a, b) => a + b, 0);
}

/** @returns {Promise<string|null>} the section, or null: off, no interface, none unread, an error or a timeout (never a zero). */
export async function resolveMailContext({ projectDir, config, logger, deps = {} }) {
  if (config?.link?.session_count === false) return null;
  const { makeAdapter = async (a) => (await import("../commands/link.js")).githubAdapter(a), timeoutMs = MAIL_TIMEOUT_MS } = deps;
  let timer;
  try {
    const adapter = await makeAdapter({ projectDir });
    if (!adapter) return null;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs); });
    const count = await Promise.race([unreadIn(projectDir, adapter), timeout]);
    return count > 0 ? `## Mail\n\n${count} unread message(s) wait for you: read them with \`kj link inbox\`.` : null;
  } catch (err) {
    logger?.warn?.(`mail count unavailable (${err.message}) — the session starts without it`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The task the coder reads: everything it was given, then its own statement. */
export function composeTask(task, sections = []) {
  const kept = sections.filter(Boolean);
  return kept.length ? `${kept.join("\n\n")}\n\n## Task\n\n${task}` : task;
}
