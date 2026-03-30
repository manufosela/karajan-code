import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, exists } from "./utils/fs.js";
import { getSessionRoot } from "./utils/paths.js";

const SESSION_ROOT = getSessionRoot();

export function newSessionId() {
  const now = new Date();
  const stamp = now.toISOString().replaceAll(/[:.]/g, "-");
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

export async function pauseSession(session, { question, context: pauseContext }) {
  session.status = "paused";
  session.paused_state = {
    question,
    context: pauseContext,
    paused_at: new Date().toISOString()
  };
  await saveSession(session);
}

export async function loadMostRecentSession() {
  let entries;
  try {
    entries = await fs.readdir(SESSION_ROOT, { withFileTypes: true });
  } catch { /* session root does not exist yet */
    return null;
  }
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  for (let i = dirs.length - 1; i >= 0; i--) {
    try {
      return await loadSession(dirs[i]);
    } catch { /* session.json missing or malformed */
      continue;
    }
  }
  return null;
}

export async function resumeSessionWithAnswer(sessionId, answer) {
  const session = await loadSession(sessionId);
  const resumable = new Set(["paused", "running", "failed", "stopped"]);
  if (!resumable.has(session.status)) {
    throw new Error(`Session ${sessionId} cannot be resumed (status: ${session.status})`);
  }
  const pausedState = session.paused_state;
  if (!pausedState) {
    throw new Error(`Session ${sessionId} has no paused state`);
  }
  session.paused_state.answer = answer;
  session.paused_state.resumed_at = new Date().toISOString();
  session.status = "running";
  await saveSession(session);
  return session;
}
