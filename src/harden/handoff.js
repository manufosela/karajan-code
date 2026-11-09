/**
 * KJC-TSK-0968 (HUM-E, ADR 0018): the agent's handoff to the human goes through
 * kj. When a gate denies the agent a command, the agent registers a HANDOFF with
 * the exact command; the why is what the gate said, read from the Sentinel's
 * record of denials, never a text of the agent. The human later reads and runs
 * it by id (E2, E3). Handoffs live in .karajan/handoffs/<id>.json, local.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HANDOFFS_DIR = ".karajan/handoffs";
// KJC-BUG-0527: traces live where the sandbox leaves the agent a writable folder.
export const DENIALS_FILE = ".karajan/traces/denials.jsonl";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** The Sentinel's denials, oldest first; a line that is not JSON is skipped. */
export function readDenials({ projectDir }) {
  let text;
  try { text = readFileSync(join(projectDir, DENIALS_FILE), "utf8"); } catch { return []; }
  return text.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

/** The latest denial of this EXACT Bash command, or null. */
export function findDenial({ projectDir, command }) {
  return readDenials({ projectDir }).findLast((d) => d?.tool === "Bash" && d?.input?.command === command) ?? null;
}

/**
 * Registers a handoff for a command a gate denied. Without a denial of those
 * exact bytes there is nothing to hand off: the agent does not write the why.
 * @returns {{id: string, command: string, sha256: string, why: string}}
 */
export function addHandoff({ projectDir, command, cwd = projectDir, why = null, blocking = false }) {
  if (typeof command !== "string" || !command.trim()) throw new Error("kj handoff add: falta el comando exacto que el gate negó");
  const denial = findDenial({ projectDir, command });
  // KJC-TSK-1066: an action only the human can take (publish, seal) is a TASK, with
  // the agent's why marked as the agent's. A command a gate denied keeps the gate's.
  const task = !denial && typeof why === "string" && why.trim();
  if (!denial && !task) throw new Error("kj handoff add: kj no tiene registrado ningún deny para ese comando exacto; el porqué de un encargo lo escribe el gate, no el agente (ADR 0018). Para una acción que solo puede hacer el humano, di para qué con --why");
  const createdAt = new Date().toISOString();
  const digest = sha256(command);
  const id = sha256(`${digest}:${createdAt}`).slice(0, 8);
  // KJC-TSK-1474: blocking = the agent cannot go on without it; any other waits while the work goes on.
  const base = { id, command, sha256: digest, cwd, createdAt, status: "pending", blocking: blocking === true };
  const record = task ? { ...base, kind: "task", why: why.trim(), denial: null } : { ...base, kind: "denial", denial: { at: denial.at, tool: denial.tool, why: denial.why } };
  writeRecord(projectDir, record);
  return record;
}

const writeRecord = (projectDir, record) => {
  mkdirSync(join(projectDir, HANDOFFS_DIR), { recursive: true });
  writeFileSync(join(projectDir, HANDOFFS_DIR, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
};

/** KJC-TSK-1066: the human did it; it leaves the pending ones and stays in the history. */
export function markHandoffDone({ projectDir, id }) {
  const record = { ...readHandoff({ projectDir, id }), status: "done", doneAt: new Date().toISOString() };
  writeRecord(projectDir, record);
  return record;
}

/** The handoff as the watch window shows it: local date and time, the command, and why. */
export function formatHandoff(h) {
  const at = new Date(h.createdAt);
  const pad = (n) => String(n).padStart(2, "0");
  const when = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const why = h.kind === "task" ? `${h.why} (propuesto por el agente)` : `lo negó el gate: ${String(h.denial?.why ?? "").split("\n")[0]}`;
  return `[${when}] ${h.id}  ${h.command}\n    ${why}`;
}

/**
 * KJC-TSK-1066: kj handoff watch. Shows the pending handoffs, then each new or
 * changed one as it lands, until the signal aborts (Ctrl+C in the CLI).
 */
export async function watchHandoffs({ projectDir, log, intervalMs = 2000, signal }) {
  const seen = new Map();
  const tick = () => {
    for (const h of listHandoffs({ projectDir })) {
      if (seen.get(h.id) === h.status) continue;
      const first = !seen.has(h.id);
      seen.set(h.id, h.status);
      if (h.status === "pending") log(formatHandoff(h));
      else if (!first) log(`[hecho] ${h.id}  ${h.command}`);
    }
  };
  tick();
  // One abort promise for the whole watch, raced against each pause: no listener per tick.
  const aborted = new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true }));
  while (!signal?.aborted) {
    let timer;
    await Promise.race([aborted, new Promise((resolve) => { timer = setTimeout(resolve, intervalMs); })]);
    clearTimeout(timer);
    if (!signal?.aborted) tick();
  }
}

export function readHandoff({ projectDir, id }) {
  if (!/^[0-9a-f]{8}$/.test(id ?? "")) throw new Error(`kj handoff: "${id}" no es un identificador de encargo (8 hex)`);
  const path = join(projectDir, HANDOFFS_DIR, `${id}.json`);
  if (!existsSync(path)) throw new Error(`kj handoff: no hay ningún encargo ${id}`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  // The bytes the human will run are the bytes that were registered, or nothing.
  if (sha256(record.command ?? "") !== record.sha256) throw new Error(`kj handoff: el encargo ${id} no coincide con su sha256: alguien lo tocó, no se ejecuta`);
  return record;
}

export function listHandoffs({ projectDir }) {
  let names;
  try { names = readdirSync(join(projectDir, HANDOFFS_DIR)).filter((n) => /^[0-9a-f]{8}\.json$/.test(n)); } catch { return []; }
  return names.map((n) => readHandoff({ projectDir, id: n.slice(0, 8) })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
