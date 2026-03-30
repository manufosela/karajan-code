import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { getKarajanHome } from "../utils/paths.js";

// FUTURE: hu-storage adapter for PG/Trello/etc — currently local files only

/**
 * Valid HU story status values.
 * @type {Readonly<{PENDING: "pending", CODING: "coding", REVIEWING: "reviewing", DONE: "done", FAILED: "failed", BLOCKED: "blocked", CERTIFIED: "certified", NEEDS_CONTEXT: "needs_context"}>}
 */
export const HU_STATUS = Object.freeze({
  PENDING: "pending",
  CODING: "coding",
  REVIEWING: "reviewing",
  DONE: "done",
  FAILED: "failed",
  BLOCKED: "blocked",
  CERTIFIED: "certified",
  NEEDS_CONTEXT: "needs_context"
});

/** @returns {string} Path to the hu-stories directory (evaluated at call time). */
function getHuDir() {
  return path.join(getKarajanHome(), "hu-stories");
}

/**
 * Create a new HU batch from an array of story definitions.
 * @param {string} sessionId - The session identifier.
 * @param {Array<{id?: string, text: string, blocked_by?: string[]}>} stories - Raw story inputs.
 * @returns {Promise<object>} The created batch object.
 */
export async function createHuBatch(sessionId, stories) {
  const dir = path.join(getHuDir(), sessionId);
  await fs.mkdir(dir, { recursive: true });

  const batch = {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    stories: stories.map((s, i) => ({
      id: s.id || `HU-${Date.now()}-${i}`,
      status: "pending",
      original: { text: s.text },
      blocked_by: s.blocked_by || [],
      certified: null,
      quality: null,
      context_requests: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }))
  };

  await fs.writeFile(path.join(dir, "batch.json"), JSON.stringify(batch, null, 2));
  return batch;
}

/**
 * Load an existing HU batch from disk.
 * @param {string} sessionId - The session identifier.
 * @returns {Promise<object>} The loaded batch object.
 */
export async function loadHuBatch(sessionId) {
  const file = path.join(getHuDir(), sessionId, "batch.json");
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

/**
 * Save a batch back to disk.
 * @param {string} sessionId - The session identifier.
 * @param {object} batch - The batch object to persist.
 * @returns {Promise<void>}
 */
export async function saveHuBatch(sessionId, batch) {
  const dir = path.join(getHuDir(), sessionId);
  batch.updated_at = new Date().toISOString();
  await fs.writeFile(path.join(dir, "batch.json"), JSON.stringify(batch, null, 2));
}

/**
 * Update the status of a single story within a batch.
 * @param {object} batch - The batch object.
 * @param {string} storyId - Story ID to update.
 * @param {string} status - New status value.
 * @param {object} [extra={}] - Additional fields to merge.
 * @returns {object} The updated story.
 */
export function updateStoryStatus(batch, storyId, status, extra = {}) {
  const story = batch.stories.find(s => s.id === storyId);
  if (!story) throw new Error(`Story ${storyId} not found`);
  story.status = status;
  const now = new Date().toISOString();
  story.statusChangedAt = now;
  story.updated_at = now;
  Object.assign(story, extra);
  return story;
}

/**
 * Store quality scores on a story.
 * @param {object} batch - The batch object.
 * @param {string} storyId - Story ID.
 * @param {object} quality - Quality scores object.
 * @returns {object} The updated story.
 */
export function updateStoryQuality(batch, storyId, quality) {
  const story = batch.stories.find(s => s.id === storyId);
  if (!story) throw new Error(`Story ${storyId} not found`);
  story.quality = { ...quality, evaluated_at: new Date().toISOString() };
  story.updated_at = new Date().toISOString();
  return story;
}

/**
 * Mark a story as certified with the provided certified data.
 * @param {object} batch - The batch object.
 * @param {string} storyId - Story ID.
 * @param {object} certified - Certified HU data.
 * @returns {object} The updated story.
 */
export function updateStoryCertified(batch, storyId, certified) {
  const story = batch.stories.find(s => s.id === storyId);
  if (!story) throw new Error(`Story ${storyId} not found`);
  story.certified = certified;
  story.status = "certified";
  story.updated_at = new Date().toISOString();
  return story;
}

/**
 * Add a context request to a story and set its status to needs_context.
 * @param {object} batch - The batch object.
 * @param {string} storyId - Story ID.
 * @param {{fields_needed: string[], question: string}} request - Context request.
 * @returns {object} The updated story.
 */
export function addContextRequest(batch, storyId, request) {
  const story = batch.stories.find(s => s.id === storyId);
  if (!story) throw new Error(`Story ${storyId} not found`);
  story.context_requests.push({
    requested_at: new Date().toISOString(),
    fields_needed: request.fields_needed,
    question_to_fde: request.question,
    answered_at: null,
    answer: null
  });
  story.status = "needs_context";
  story.updated_at = new Date().toISOString();
  return story;
}

/**
 * Answer the most recent pending context request and reset status to pending.
 * @param {object} batch - The batch object.
 * @param {string} storyId - Story ID.
 * @param {string} answer - The FDE's answer.
 * @returns {object} The updated story.
 */
export function answerContextRequest(batch, storyId, answer) {
  const story = batch.stories.find(s => s.id === storyId);
  if (!story) throw new Error(`Story ${storyId} not found`);
  const pending = story.context_requests.find(r => !r.answered_at);
  if (pending) {
    pending.answered_at = new Date().toISOString();
    pending.answer = answer;
  }
  story.status = "pending"; // back to pending for re-evaluation
  story.updated_at = new Date().toISOString();
  return story;
}

/**
 * Create a lightweight history record for a pipeline run.
 * Stores a minimal single-HU batch in the same hu-stories directory
 * so the HU Board can pick it up alongside full batches.
 * @param {string} sessionId - The session identifier.
 * @param {{task: string, result: string, approved: boolean, summary?: string, timestamp?: string}} data
 * @returns {Promise<object>} The created batch object.
 */
export async function createHistoryRecord(sessionId, { task, result, approved, summary, timestamp }) {
  const ts = timestamp || new Date().toISOString();
  const dir = path.join(getHuDir(), sessionId);
  await fs.mkdir(dir, { recursive: true });

  const batch = {
    session_id: sessionId,
    created_at: ts,
    stories: [
      {
        id: `HU-hist-${sessionId}`,
        status: approved ? "certified" : "failed",
        original: { text: task },
        blocked_by: [],
        certified: approved ? { summary: summary || result } : null,
        quality: null,
        context_requests: [],
        created_at: ts,
        updated_at: ts
      }
    ],
    history: {
      task,
      result,
      approved,
      summary: summary || null,
      timestamp: ts
    }
  };

  await fs.writeFile(path.join(dir, "batch.json"), JSON.stringify(batch, null, 2));
  return batch;
}

/* ── Splitting metadata ──────────────────────────────────────────── */

/**
 * Add splitting metadata to a story within a batch.
 * Used to track the relationship between an original HU and its sub-HUs
 * after a split operation.
 *
 * @param {object} batch - The batch object.
 * @param {string} huId - Story ID to annotate.
 * @param {{ original_hu_id?: string, split_children?: string[], indicators_detected?: string[], heuristic_applied?: string, split_confirmed_by_fde?: boolean, validation?: object }} metadata - Splitting metadata.
 * @returns {object} The updated story.
 */
export function addSplittingMetadata(batch, huId, metadata) {
  const story = batch.stories.find(s => s.id === huId);
  if (!story) throw new Error(`Story ${huId} not found`);
  story.splitting = { ...(story.splitting || {}), ...metadata };
  story.updated_at = new Date().toISOString();
  return story;
}

/* ── Manual HU management ─────────────────────────────────────────── */

/**
 * Detect project info from the given directory.
 * @param {string} cwd - Directory to detect project from.
 * @returns {Promise<{ name: string, remoteUrl: string|null }>}
 */
export async function detectProject(cwd) {
  const name = path.basename(cwd);
  let remoteUrl = null;
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
    remoteUrl = stdout.trim();
  } catch { /* not a git repo or no remote */ }
  return { name, remoteUrl };
}

/**
 * Derive a project slug from a directory path.
 * @param {string} projectDir - Absolute path to the project.
 * @returns {string}
 */
function projectSlug(projectDir) {
  return path.basename(projectDir);
}

/**
 * Get the batch file path for a project.
 * @param {string} projectDir
 * @returns {string}
 */
function projectBatchPath(projectDir) {
  return path.join(getHuDir(), projectSlug(projectDir), "batch.json");
}

/**
 * Load the project batch, or return a fresh empty batch if none exists.
 * @param {string} projectDir
 * @returns {Promise<object>}
 */
async function loadProjectBatch(projectDir) {
  const filePath = projectBatchPath(projectDir);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      project: projectSlug(projectDir),
      created_at: new Date().toISOString(),
      stories: []
    };
  }
}

/**
 * Save a project batch to disk (auto-creates directory).
 * @param {string} projectDir
 * @param {object} batch
 */
async function saveProjectBatch(projectDir, batch) {
  const filePath = projectBatchPath(projectDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  batch.updated_at = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(batch, null, 2));
}

/**
 * Create a manual HU (user story) for a project.
 * Auto-creates the batch file if it doesn't exist.
 * @param {string} projectDir
 * @param {{ title: string, description?: string, status?: string, acceptanceCriteria?: string }} data
 * @returns {Promise<object>} The created HU.
 */
export async function createManualHu(projectDir, { title, description, status, acceptanceCriteria }) {
  if (!title) throw new Error("title is required to create a HU");
  const batch = await loadProjectBatch(projectDir);
  const now = new Date().toISOString();
  const hu = {
    id: `HU-${Date.now()}-${batch.stories.length}`,
    title,
    description: description || "",
    status: status || HU_STATUS.PENDING,
    acceptanceCriteria: acceptanceCriteria || "",
    createdAt: now,
    updatedAt: now
  };
  batch.stories.push(hu);
  await saveProjectBatch(projectDir, batch);
  return hu;
}

/**
 * List all HUs for a project.
 * @param {string} projectDir
 * @returns {Promise<Array<{ id: string, title: string, status: string, createdAt: string }>>}
 */
export async function listHus(projectDir) {
  const batch = await loadProjectBatch(projectDir);
  return batch.stories.map(s => ({
    id: s.id,
    title: s.title,
    status: s.status,
    createdAt: s.createdAt
  }));
}

/**
 * Update the status of a specific HU.
 * @param {string} projectDir
 * @param {string} huId
 * @param {string} status
 * @returns {Promise<object>} The updated HU.
 */
export async function updateHuStatus(projectDir, huId, status) {
  const batch = await loadProjectBatch(projectDir);
  const hu = batch.stories.find(s => s.id === huId);
  if (!hu) throw new Error(`HU ${huId} not found`);
  hu.status = status;
  hu.updatedAt = new Date().toISOString();
  await saveProjectBatch(projectDir, batch);
  return hu;
}

/**
 * Get a single HU by id.
 * @param {string} projectDir
 * @param {string} huId
 * @returns {Promise<object>}
 */
export async function getHu(projectDir, huId) {
  const batch = await loadProjectBatch(projectDir);
  const hu = batch.stories.find(s => s.id === huId);
  if (!hu) throw new Error(`HU ${huId} not found`);
  return hu;
}
