/**
 * kj link send|inbox (HU-3804, ADR 0043): an agent talks to the agents of other people
 * through the board's message adapter. PULL ONLY: nothing here starts itself or pushes a body into an
 * agent's context. Rejected: a long-running `kj link watch` printing messages as they arrive; it would put
 * an untrusted body in front of an agent unasked. Pull keeps "when to read" with the person.
 */
import fs from "node:fs";
import { dirname } from "node:path";
import { readBoardConfig } from "../hu/board-config.js";
import { pinGhIdentity } from "../hu/gh-identity.js";
import { LINK_FIELDS } from "../link/block.js";
import { loadRecord, markRead, recordPath, saveRecord } from "../link/record.js";
import { readInbox } from "../link/reader.js";
import { PostRefusedError, prepareToPost, renderForAgent } from "../link/wrap.js";

const NO_INTERFACE = "this board has no message interface";
const ADAPTER_KIND = { issue: "issue", pr: "pull_request" };
// The block needs an id before GitHub has assigned one; `inbox` reports the real comment id as messageId.
const PENDING_ID = "pending";

/** `issue:<n>` or `pr:<n>` into the record key and the adapter's thread. */
function parseThread(value) {
  const [, kind, digits] = /^(issue|pr):([1-9]\d{0,9})$/.exec(value ?? "") ?? [];
  if (!kind) throw new Error("thread must be issue:<n> or pr:<n>");
  const number = Number(digits);
  return { key: { kind, number }, thread: { kind: ADAPTER_KIND[kind], number }, name: `${kind}:${number}` };
}

/** The GitHub adapter when the board is a GitHub one; any other board has no message interface (null). */
export async function githubAdapter({ projectDir, pin = pinGhIdentity }) {
  const board = await readBoardConfig(projectDir);
  if (board.backend !== "github") return null;
  pin({ projectDir }); // ADR 0040: gh goes out as the account this clone declares, as the rest of the board does
  const { createGithubMessageReader } = await import("../../packages/board-github/src/messages.js");
  return createGithubMessageReader({ repo: board.repo });
}

/** What a person or an agent sees of one message: the wrapper in human format, never a bare body. */
const render = (m) => {
  const note = m.kind !== "message";
  return renderForAgent({ author: m.author, permission: "write", type: note ? "note" : m.type, conclusion: note ? "" : m.conclusion, suspect: m.suspect, body: note ? m.text : LINK_FIELDS.map((k) => `${k}: ${m[k]}`).join("\n") });
};

const adapterOf = async (makeAdapter, projectDir) => (await makeAdapter({ projectDir })) ?? Promise.reject(new Error(NO_INTERFACE));

async function send({ projectDir, flags, log, makeAdapter }) {
  const { key, thread } = parseThread(flags.thread);
  const block = { v: 1, type: flags.type, id: PENDING_ID, reply_to: flags.replyTo ?? null, context: flags.context ?? `${key.kind}-${key.number}`, to: flags.to, speaker: "agent" };
  const { text, warnings } = prepareToPost({ conclusion: flags.text, block });
  const adapter = await adapterOf(makeAdapter, projectDir);
  for (const w of warnings) log(`warning: ${w.type} on line ${w.line}`);
  const { id } = await adapter.publish(thread, { body: text });
  log(`posted message ${id}`);
}

/** One line per failure: the code when there is one, then the message. */
const describeError = (err) => (err instanceof PostRefusedError ? `refused (${err.code}): ${err.message}` : err.code ? `${err.code}: ${err.message}` : err.message);

/** The threads with a record under .karajan/link/, as keys; a name that is not `<kind>-<n>.json` is not a record. */
function knownThreads(projectDir) {
  let files;
  try {
    files = fs.readdirSync(dirname(recordPath(projectDir, { kind: "issue", number: 1 })));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return files.map((f) => /^(issue|pr)-([1-9]\d{0,9})\.json$/.exec(f)).filter(Boolean).map(([, kind, n]) => parseThread(`${kind}:${n}`));
}

async function threads({ projectDir, flags, log }) {
  const rows = knownThreads(projectDir).map(({ key, name }) => {
    try {
      const times = Object.values(loadRecord(projectDir, key).seen).map((e) => e.updatedAt);
      return { thread: name, seen: times.length, last: times.reduce((a, b) => (b > a ? b : a), "") || undefined };
    } catch (err) {
      return { thread: name, error: describeError(err) };
    }
  }).sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.thread.localeCompare(b.thread));
  if (flags.json) log(JSON.stringify(rows));
  else if (rows.length === 0) log("no threads yet");
  else for (const r of rows) log(r.error ? `${r.thread}: error ${r.error}` : `${r.thread}: ${r.seen} messages seen, last ${r.last ?? "never"}`);
}

async function limits({ projectDir, flags, log, makeAdapter }) {
  const adapter = await adapterOf(makeAdapter, projectDir);
  const l = await adapter.limits();
  log(flags.json ? JSON.stringify(l) : `quota left: ${l.quotaLeft}\npolling interval: ${l.minPollIntervalMs} ms\nwrite gap: ${l.minWritePauseMs} ms`);
}

/** Without --thread: every known thread, one after another; a failing one is reported and the rest go on. */
async function inbox({ projectDir, flags, log, makeAdapter }) {
  const adapter = await adapterOf(makeAdapter, projectDir);
  if (flags.thread) return readThread({ projectDir, flags, log, adapter, ...parseThread(flags.thread) });
  let failed = 0;
  for (const known of knownThreads(projectDir)) {
    try {
      await readThread({ projectDir, flags, log, adapter, ...known });
    } catch (err) {
      failed++;
      log(flags.json ? JSON.stringify({ thread: known.name, error: describeError(err) }) : `${known.name}: ${describeError(err)}`);
    }
  }
  return { failed };
}

async function readThread({ projectDir, flags, log, adapter, key, thread, name }) {
  const store = loadRecord(projectDir, key);
  const result = await readInbox({ adapter, thread, store });
  const { messages, dropped } = result;
  if (flags.json) log(JSON.stringify({ thread: name, messages, dropped }));
  else {
    log(`${name}: ${messages.length} new, ${dropped.notPermitted + dropped.permissionError} dropped for permission`);
    for (const m of messages) log(render(m));
  }
  // The cursor moves after everything was printed, and only when asked.
  if (flags.markRead) saveRecord(projectDir, key, markRead(store, result));
}

const ACTIONS = { send, inbox, threads, limits };

/** An action reports a partial failure as `{ failed: <count> }`; anything else is success. @returns {Promise<0|1>} */
export async function linkCommand({ action, config, flags = {}, log = console.log, makeAdapter = githubAdapter }) {
  try {
    if (!Object.hasOwn(ACTIONS, action)) throw new Error(`unknown link action "${action}": use send, inbox, threads or limits`);
    return (await ACTIONS[action]({ projectDir: config?.projectDir || process.cwd(), flags, log, makeAdapter }))?.failed > 0 ? 1 : 0;
  } catch (err) {
    // A refusal names its code and the finding types and lines (never the matched text).
    log(describeError(err));
    return 1;
  }
}
