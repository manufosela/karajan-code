/**
 * kj link send|inbox (HU-3804, ADR 0043): an agent talks to the agents of other people
 * through the board's message adapter. PULL ONLY: nothing here starts itself or pushes a body into an
 * agent's context. Rejected: a long-running `kj link watch` printing messages as they arrive; it would put
 * an untrusted body in front of an agent unasked. Pull keeps "when to read" with the person.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { readBoardConfig } from "../hu/board-config.js";
import { pinGhIdentity } from "../hu/gh-identity.js";
import { LINK_FIELDS } from "../link/block.js";
import { loadRecord, markRead, recordPath, saveRecord } from "../link/record.js";
import { readInbox } from "../link/reader.js";
import { PostRefusedError, prepareToPost, renderForAgent } from "../link/wrap.js";
import * as realSenescal from "../link/senescal.js";

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

// The owner may rename these: `kj link ceremony <step>`. Nothing else in this file spells them.
export const CEREMONY_STEPS = ["convene", "gather", "close"];
const need = (flags, name, option) => flags[name] ?? Promise.reject(new Error(`ceremony ${flags.step} needs ${option}`));
const SUMMARY_SECTIONS = ["conclusions", "improvements", "decisions", "rules"];
const MAX_SUMMARY_BYTES = 64 * 1024;

/** The summary of a ceremony from a JSON file: `{ conclusions, improvements, decisions, rules }`, each a list of `{ text, authors, security? }`. Fails before anything is written. */
function readSummary(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    throw new Error(`cannot read the summary file: ${err.code ?? err.message}`, { cause: err });
  }
  if (!stat.isFile()) throw new Error("the summary file must be a regular file");
  if (stat.size > MAX_SUMMARY_BYTES) throw new Error(`the summary file is too large (limit ${MAX_SUMMARY_BYTES} bytes)`);
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error("the summary file is not valid JSON", { cause: err });
  }
  if (summary === null || typeof summary !== "object" || Array.isArray(summary)) throw new Error("the summary must be an object of sections");
  for (const [section, items] of Object.entries(summary)) {
    if (!SUMMARY_SECTIONS.includes(section)) throw new Error(`unknown section "${section}" in the summary: use ${SUMMARY_SECTIONS.join(", ")}`);
    const valid = Array.isArray(items) && items.every((i) => typeof i?.text === "string" && (i.authors === undefined || typeof i.authors === "string" || (Array.isArray(i.authors) && i.authors.every((a) => typeof a === "string"))));
    if (!valid) throw new Error(`section "${section}" must be a list of items with a text and authors`);
  }
  return summary;
}

// The Senescal takes git and the pull request as parameters; these are the real ones, tests inject their own.
const execFileAsync = promisify(execFile);
// git asks gh for its HTTPS credential, so the push goes out with the pinned token too (an SSH remote uses its key).
const GH_CREDENTIAL = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];

/** git and gh as the account this clone declares (ADR 0040): the pinned token passed in their env, never the active account by accident. */
function pinnedTools(projectDir, deps) {
  const env = { ...process.env };
  const { declared } = (deps.pin ?? pinGhIdentity)({ projectDir, env });
  const exec = deps.exec ?? execFileAsync;
  const tool = (cmd, pre = []) => async (args) => (await exec(cmd, [...pre, ...args], { cwd: projectDir, env })).stdout.trim();
  const gh = tool("gh");
  const openPr = async ({ branch, title, body }) => ({ url: (await gh(["pr", "create", "--head", branch, "--title", title, "--body", body])).split("\n").at(-1) });
  return { git: deps.git ?? tool("git", declared ? GH_CREDENTIAL : []), openPr: deps.openPr ?? openPr };
}

/** A thin layer over the Senescal: options in, its answer out. `deps` injects the Senescal and the clock. */
async function ceremony({ projectDir, flags, log, makeAdapter, deps }) {
  const { convene, gather, close } = deps.senescal ?? realSenescal;
  const now = deps.now ?? Date.now;
  if (!CEREMONY_STEPS.includes(flags.step)) throw new Error(`unknown ceremony step "${flags.step}": use ${CEREMONY_STEPS.join(", ")}`);
  if (flags.step === "convene") {
    const input = { kind: await need(flags, "kind", "--kind"), title: await need(flags, "title", "--title"), agenda: await need(flags, "agenda", "--agenda") };
    const { thread, opened } = await convene(await adapterOf(makeAdapter, projectDir), { ...input, now });
    const name = `${thread.kind}:${thread.number}`;
    return log(flags.json ? JSON.stringify({ thread, opened }) : opened ? `opened ${input.kind} ceremony ${name}` : `${input.kind} ceremony already open: ${name}`);
  }
  const parsed = parseThread(await need(flags, "thread", "--thread"));
  if (flags.step === "close") {
    const author = await need(flags, "author", "--author");
    const summary = readSummary(await need(flags, "summaryFile", "--summary-file"));
    const adapter = await adapterOf(makeAdapter, projectDir);
    const result = await close(adapter, parsed.thread, summary, { author, repo: projectDir, ...pinnedTools(projectDir, deps), now });
    return log(flags.json ? JSON.stringify({ thread: parsed.name, ...result }) : `proposed the result as a pull request: ${result.url}`);
  }
  // gather is read-only: no cursor moves, so a second run shows the same contributions
  const { byAuthor, dropped } = await gather(await adapterOf(makeAdapter, projectDir), parsed.thread, { record: loadRecord(projectDir, parsed.key), now });
  if (flags.json) return log(JSON.stringify({ thread: parsed.name, byAuthor, dropped }));
  log(`${parsed.name}: ${byAuthor.length} authors, ${dropped.notPermitted + dropped.permissionError} dropped for permission`);
  for (const { author, contributions } of byAuthor) log(`${author}:`, ...contributions.map(render));
}

const ACTIONS = { send, inbox, threads, limits, ceremony };

/** An action reports a partial failure as `{ failed: <count> }`; anything else is success. @returns {Promise<0|1>} */
export async function linkCommand({ action, config, flags = {}, log = console.log, makeAdapter = githubAdapter, deps = {} }) {
  try {
    if (!Object.hasOwn(ACTIONS, action)) throw new Error(`unknown link action "${action}": use send, inbox, threads, limits or ceremony`);
    return (await ACTIONS[action]({ projectDir: config?.projectDir || process.cwd(), flags, log, makeAdapter, deps }))?.failed > 0 ? 1 : 0;
  } catch (err) {
    // A refusal names its code and the finding types and lines (never the matched text).
    log(describeError(err));
    return 1;
  }
}
