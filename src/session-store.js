import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, exists } from "./utils/fs.js";

const SESSION_ROOT = path.resolve(process.cwd(), ".karajan", "sessions");

export function newSessionId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `s_${stamp}`;
}

export async function createSession(initial = {}) {
  const id = initial.id || newSessionId();
  const dir = path.join(SESSION_ROOT, id);
  await ensureDir(dir);
  const data = {
    id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "running",
    checkpoints: [],
    ...initial
  };
  await saveSession(data);
  return data;
}

export async function saveSession(session) {
  const dir = path.join(SESSION_ROOT, session.id);
  await ensureDir(dir);
  session.updated_at = new Date().toISOString();
  await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(session, null, 2), "utf8");
}

export async function loadSession(sessionId) {
  const file = path.join(SESSION_ROOT, sessionId, "session.json");
  if (!(await exists(file))) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

export async function addCheckpoint(session, checkpoint) {
  session.checkpoints.push({ at: new Date().toISOString(), ...checkpoint });
  await saveSession(session);
}

export async function markSessionStatus(session, status) {
  session.status = status;
  await saveSession(session);
}
