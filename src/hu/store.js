import fs from "node:fs/promises";
import path from "node:path";
import { getKarajanHome } from "../utils/paths.js";

// FUTURE: hu-storage adapter for PG/Trello/etc — currently local files only

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
  story.updated_at = new Date().toISOString();
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
