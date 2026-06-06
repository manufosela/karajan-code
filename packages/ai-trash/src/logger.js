// Append-only JSONL audit log for the trash store. Events are written one
// JSON object per line so the file can be `tail -f`-d and parsed
// line-by-line without holding the whole log in memory.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { lockdownFile } from "./permissions.js";

const HOME = homedir();

function redactPath(p) {
  if (typeof p !== "string" || !p) return p;
  if (p === HOME) return "~";
  if (p.startsWith(`${HOME}/`)) return `~/${p.slice(HOME.length + 1)}`;
  return p;
}

function redactPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" && (k.includes("Path") || k === "cwd")) {
      out[k] = redactPath(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function appendLogEntry(rootDir, event, payload = {}) {
  if (!event) throw new Error("ai-trash: log event required");
  const file = join(rootDir, "log.jsonl");
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...redactPayload(payload),
    }) + "\n";
  await fs.mkdir(rootDir, { recursive: true });
  await fs.appendFile(file, line, { encoding: "utf8", mode: 0o600 });
  await lockdownFile(file);
}

export async function readLog(rootDir) {
  const file = join(rootDir, "log.jsonl");
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export { redactPath };
