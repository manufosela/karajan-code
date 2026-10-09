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
export const DENIALS_FILE = ".karajan/harness/denials.jsonl";
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
export function addHandoff({ projectDir, command, cwd = projectDir }) {
  if (typeof command !== "string" || !command.trim()) throw new Error("kj handoff add: falta el comando exacto que el gate negó");
  const denial = findDenial({ projectDir, command });
  if (!denial) throw new Error("kj handoff add: kj no tiene registrado ningún deny para ese comando exacto; el porqué de un encargo lo escribe el gate, no el agente (ADR 0018)");
  const createdAt = new Date().toISOString();
  const digest = sha256(command);
  const id = sha256(`${digest}:${createdAt}`).slice(0, 8);
  const record = { id, command, sha256: digest, cwd, createdAt, status: "pending", denial: { at: denial.at, tool: denial.tool, why: denial.why } };
  mkdirSync(join(projectDir, HANDOFFS_DIR), { recursive: true });
  writeFileSync(join(projectDir, HANDOFFS_DIR, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
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
