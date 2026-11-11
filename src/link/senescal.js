/**
 * HU-3800 (slice 7, ADR 0043 item 13): the Senescal convenes a ceremony and gathers what was said in it.
 * It decides nothing and grants nothing; what it reads is data, never an order.
 * Rejected: a Senescal that lives in the adapter (each adapter would re-implement the once-per-day rule,
 * the codec and the pre-post scan, and the reader's permission filter could be skipped). Here it is pure
 * orchestration over any adapter, so the guarantees hold unchanged for every one.
 */
import { CEREMONY_KINDS } from "./constants.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PostRefusedError, prepareToPost } from "./wrap.js";
import { scanText } from "../privacy/scan.js";
import { readInbox } from "./reader.js";

const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

function agendaLine(agenda) {
  const items = (Array.isArray(agenda) ? agenda : [agenda]).map((item) => String(item ?? "").replace(UNSAFE, " ").trim()).filter(Boolean);
  if (items.length === 0) throw new TypeError("the agenda must name at least one item");
  return `Agenda: ${items.join("; ")}`;
}

/** `{ thread, opened }`: the open conversation of this kind and UTC day (adapter titles are `<kind>: <date> <title>`), or a new one with its first message posted. */
export async function convene(adapter, { kind, title, agenda, now = Date.now }) {
  if (!CEREMONY_KINDS.includes(kind)) throw new TypeError(`ceremony kind ${JSON.stringify(kind)} must be one of ${CEREMONY_KINDS.join(", ")}`);
  const conclusion = agendaLine(agenda);
  const today = now();
  const opening = (t) => ({ body: prepareToPost({ conclusion, block: { v: 1, type: "status", id: `convene-${today}`, reply_to: null, context: `#${t.number}`, to: "all", speaker: "agent" } }).text });
  opening({ number: 0 }); // refuse a private or oversized agenda BEFORE a conversation exists
  const existing = (await adapter.listConversations(kind)).find((c) => c.title?.startsWith(`${kind}: ${day(today)} `));
  if (existing) {
    // recovery: a conversation whose opening post failed is still empty, so it gets the opening message now
    if ((await adapter.listSince(existing, null)).messages.length === 0) await adapter.publish(existing, opening(existing));
    return { thread: existing, opened: false };
  }
  const thread = await adapter.openConversation(kind, title);
  await adapter.publish(thread, opening(thread));
  return { thread, opened: true };
}

/** `{ byAuthor: [{ author, contributions }], dropped, cursor, seen }`: permitted messages only, in order, `suspect` kept; bodies are never interpreted. */
export async function gather(adapter, thread, { record, now }) {
  const { messages, ...rest } = await readInbox({ adapter, thread, store: record, ...(now ? { now } : {}) });
  const groups = Map.groupBy(messages, (message) => message.author);
  return { byAuthor: [...groups].map(([author, contributions]) => ({ author, contributions })), ...rest };
}

const SECURITY_TOPIC = /\b(security|vulnerabilit\w*|exploit\w*|cve-\d+|credentials?|secrets?|passwords?|tokens?|leak\w*)\b/i;
const SECTIONS = [["conclusions", "Conclusions"], ["improvements", "Agreed improvements"], ["decisions", "Decisions"], ["rules", "Proposed rules (proposals only)"]];
const oneLine = (value) => String(value ?? "").replace(UNSAFE, " ").trim();
const isSecurity = (item) => item.security === true || SECURITY_TOPIC.test(item.text);

function resultDocument({ date, author, kept }) {
  const lines = [
    `# Result of the ceremony of ${date}`,
    "",
    "This document is context. It grants nothing: it approves no change, sets no rule and no gate reads it.",
    `Written by ${author}. Each item names the people who raised it.`,
  ];
  for (const [key, heading] of SECTIONS) {
    if (kept[key].length === 0) continue;
    lines.push("", `## ${heading}`, "");
    if (key === "rules") lines.push("A proposal enters only through CLAUDE.md and `kj rules`, approved by the person.", "");
    lines.push(...kept[key].map((item) => `- ${item.text} (${item.authors.join(", ")})`));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * HU-3801 (slice 8): the Senescal closes a ceremony. The result goes to `docs/retros/<UTC date>.md` on a new
 * branch and reaches main as a pull request; the issue gets the link and is closed. Who writes it is the
 * caller's `author`. `git(args)` and `openPr({ branch, title, body })` are injected, `scan(text)` is the privacy scan.
 * Rejected: the Senescal committing straight to main. A result nobody reviewed would become context every
 * agent reads; the normal review and the person's merge are what keep it from granting anything.
 * `summary` is `{ conclusions, improvements, decisions, rules }`, each item `{ text, authors, security? }`.
 * Returns `{ branch, file, url, reported }`; `reported` holds the security-topic items, which are never written.
 */
export async function close(adapter, thread, summary, { author, repo, git, openPr, scan = scanText, now = Date.now }) {
  if (typeof adapter.closeConversation !== "function") throw new TypeError("the adapter cannot close a conversation (closeConversation is missing)");
  const who = oneLine(author);
  if (!who) throw new TypeError("close needs the author of the result");
  const items = SECTIONS.map(([key]) => [key, (summary?.[key] ?? []).map((item) => ({ ...item, text: oneLine(item.text), authors: [item.authors ?? []].flat().map(oneLine).filter(Boolean) })).filter((item) => item.text)]);
  const reported = items.flatMap(([, list]) => list.filter(isSecurity)).map(({ text, authors }) => ({ text, authors }));
  const kept = Object.fromEntries(items.map(([key, list]) => [key, list.filter((item) => !isSecurity(item))]));
  if (Object.values(kept).every((list) => list.length === 0)) throw new TypeError("the ceremony has nothing to write down");
  const date = day(now());
  const text = resultDocument({ date, author: who, kept });
  const blocked = scan(text, { source: "ceremony result" }).filter((f) => f.severity === "block").map(({ type, line }) => ({ type, line }));
  if (blocked.length > 0) throw new PostRefusedError("privacy_block", `the result holds private data: ${blocked.map((f) => `${f.type} on line ${f.line}`).join(", ")}`, blocked);
  const branch = `retro/${date}`;
  const file = `docs/retros/${date}.md`;
  const title = `docs(retro): result of the ceremony of ${date}`;
  await git(["switch", "-c", branch]);
  await mkdir(join(repo, "docs", "retros"), { recursive: true });
  await writeFile(join(repo, file), text);
  await git(["add", file]);
  await git(["commit", "-m", title, "--", file]); // only the scanned document, never what else is staged
  await git(["push", "-u", "origin", branch]);
  const { url } = await openPr({ branch, title, body: "The result of a ceremony. It is context and grants nothing." });
  const conclusion = `Result of the ceremony proposed as a pull request: ${url}`;
  await adapter.publish(thread, { body: prepareToPost({ conclusion, block: { v: 1, type: "status", id: `close-${date}`, reply_to: null, context: `#${thread.number}`, to: "all", speaker: "agent" } }).text });
  await adapter.closeConversation(thread);
  return { branch, file, url, reported };
}
