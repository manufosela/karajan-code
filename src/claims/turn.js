/**
 * Reading one turn out of the transcript (CLM-B, KJC-TSK-0802).
 *
 * The transcript is the register of sources: what the AI finally said, what the
 * user asked, and every tool output in between. Nothing is annotated by hand —
 * this just reads what the session already wrote.
 *
 * A turn = from the user's last real message to the end. A "user" entry whose
 * content is a tool_result is NOT the user talking: it is the machine answering.
 */
import { readFileSync } from "node:fs";

const MAX_OUTPUT = 20_000; // a single huge output must not eat the whole check
const blocks = (entry) => {
  const c = entry?.message?.content;
  return Array.isArray(c) ? c : typeof c === "string" ? [{ type: "text", text: c }] : [];
};
const isToolResult = (entry) => blocks(entry).some((b) => b.type === "tool_result");
const textOf = (value) =>
  typeof value === "string" ? value : Array.isArray(value) ? value.map((b) => b?.text ?? "").join("\n") : String(value ?? "");

/** Parses the JSONL, ignoring lines that are not valid JSON (a partial write must not throw). */
export function readEntries(path) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a half-written line is not a reason to fail */ }
  }
  return out;
}

/**
 * @param {string} path transcript_path given by the hook
 * @returns {{text: string, outputs: string[], userSaid: string}}
 *   text: what the AI says at the end of the turn (its final prose, no thinking).
 */
export function readTurn(path) {
  const entries = readEntries(path);
  const startedAt = entries.findLastIndex((e) => e.type === "user" && !isToolResult(e));
  const turn = startedAt >= 0 ? entries.slice(startedAt) : entries;

  const userSaid = startedAt >= 0 ? textOf(entries[startedAt]?.message?.content) : "";
  const outputs = [];
  for (const entry of turn) {
    for (const b of blocks(entry)) {
      if (b.type === "tool_result") outputs.push(textOf(b.content).slice(0, MAX_OUTPUT));
    }
  }
  // The final message is the last assistant entry that actually says something
  // (one with tool_use only is the AI working, not the AI reporting).
  const finals = turn.filter((e) => e.type === "assistant" && blocks(e).some((b) => b.type === "text" && b.text?.trim()));
  const text = finals.length ? blocks(finals.at(-1)).filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
  return { text, outputs, userSaid };
}
