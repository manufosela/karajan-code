import { watch } from 'chokidar';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  getKjHome,
  upsertProject,
  upsertStory,
  upsertSession,
  insertContextRequest,
  getDb,
} from './db.js';

/**
 * Parses a batch.json HU stories file and syncs to SQLite.
 * @param {string} filePath - Absolute path to the batch.json file
 */
function syncStoryFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const sessionId = data.session_id || basename(join(filePath, '..'));
    const projectId = data.project_id || sessionId;

    upsertProject({
      id: projectId,
      name: data.project_name || projectId,
      last_activity: data.created_at || new Date().toISOString(),
      total_stories: (data.stories || []).length,
    });

    for (const story of data.stories || []) {
      const certified = story.certified || {};
      const quality = story.quality || {};
      const dimensions = quality.dimensions || {};

      upsertStory({
        id: story.id,
        project_id: projectId,
        session_id: sessionId,
        status: story.status || 'pending',
        title: extractTitle(story),
        original_text: story.original?.text || null,
        certified_as: certified.as || null,
        certified_want: certified.want || null,
        certified_so_that: certified.so_that || null,
        quality_total: quality.total ?? null,
        quality_d1: dimensions.d1 ?? null,
        quality_d2: dimensions.d2 ?? null,
        quality_d3: dimensions.d3 ?? null,
        quality_d4: dimensions.d4 ?? null,
        quality_d5: dimensions.d5 ?? null,
        quality_d6: dimensions.d6 ?? null,
        antipatterns: quality.antipatterns ? JSON.stringify(quality.antipatterns) : null,
        ac_format: story.acceptance_criteria?.format || null,
        acceptance_criteria: story.acceptance_criteria?.criteria
          ? JSON.stringify(story.acceptance_criteria.criteria)
          : null,
        created_at: story.created_at,
        updated_at: story.updated_at,
        certified_at: story.certified_at || null,
      });

      // Sync context requests
      for (const ctx of story.context_requests || []) {
        insertContextRequest({
          story_id: story.id,
          fields_needed: ctx.fields_needed ? JSON.stringify(ctx.fields_needed) : null,
          question: ctx.question || null,
          answer: ctx.answer || null,
          requested_at: ctx.requested_at || null,
          answered_at: ctx.answered_at || null,
        });
      }
    }

    console.log(`[sync] Synced stories from ${basename(join(filePath, '..'))}: ${(data.stories || []).length} stories`);
  } catch (err) {
    console.error(`[sync] Error syncing story file ${filePath}:`, err.message);
  }
}

/**
 * Extracts a short title from a story.
 * @param {object} story
 * @returns {string}
 */
function extractTitle(story) {
  const text = story.original?.text || '';
  if (story.certified?.want) {
    return story.certified.want.slice(0, 120);
  }
  return text.slice(0, 120) || story.id;
}

/**
 * Parses a session.json file and syncs to SQLite.
 * @param {string} filePath - Absolute path to session.json
 */
function syncSessionFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const sessionId = data.id || basename(join(filePath, '..'));
    const projectId = data.project_id || 'default';

    // Calculate iterations from checkpoints
    const checkpoints = data.checkpoints || [];
    const maxIteration = checkpoints.reduce((max, cp) => Math.max(max, cp.iteration || 0), 0);

    // Calculate duration from first and last checkpoint
    let durationMs = null;
    if (data.created_at && data.updated_at) {
      durationMs = new Date(data.updated_at).getTime() - new Date(data.created_at).getTime();
    }

    // Collect completed stages
    const stagesSet = new Set();
    for (const cp of checkpoints) {
      if (cp.stage && !cp.stage.includes('attempt') && !cp.stage.includes('checkpoint')) {
        stagesSet.add(cp.stage);
      }
    }

    upsertProject({
      id: projectId,
      name: projectId,
      last_activity: data.updated_at || data.created_at || new Date().toISOString(),
    });

    upsertSession({
      id: sessionId,
      project_id: projectId,
      task: data.task || null,
      status: data.status || 'unknown',
      created_at: data.created_at,
      updated_at: data.updated_at,
      iterations: maxIteration,
      duration_ms: durationMs,
      approved: data.status === 'approved' ? 1 : 0,
      commits: data.commits ? JSON.stringify(data.commits) : null,
      stages_completed: JSON.stringify([...stagesSet]),
      checkpoints: JSON.stringify(checkpoints),
      llm_calls: data.llm_calls ? JSON.stringify(data.llm_calls) : null,
      config_snapshot: data.config_snapshot ? JSON.stringify(data.config_snapshot) : null,
      budget: data.budget ? JSON.stringify(data.budget) : null,
    });

    console.log(`[sync] Synced session ${sessionId}: status=${data.status}, iterations=${maxIteration}`);
  } catch (err) {
    console.error(`[sync] Error syncing session file ${filePath}:`, err.message);
  }
}

/**
 * Performs a full scan of all existing JSON files.
 */
export function fullScan() {
  const kjHome = getKjHome();
  const storiesDir = join(kjHome, 'hu-stories');
  const sessionsDir = join(kjHome, 'sessions');

  // Clear existing data for a clean rebuild
  const db = getDb();
  db.exec('DELETE FROM context_requests');
  db.exec('DELETE FROM stories');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM projects');

  // Scan stories
  if (existsSync(storiesDir)) {
    const dirs = readdirSync(storiesDir);
    for (const dir of dirs) {
      const batchPath = join(storiesDir, dir, 'batch.json');
      if (existsSync(batchPath)) {
        syncStoryFile(batchPath);
      }
    }
  }

  // Scan sessions
  if (existsSync(sessionsDir)) {
    const dirs = readdirSync(sessionsDir);
    for (const dir of dirs) {
      const sessionPath = join(sessionsDir, dir, 'session.json');
      if (existsSync(sessionPath)) {
        syncSessionFile(sessionPath);
      }
    }
  }

  console.log('[sync] Full scan completed');
}

/**
 * Starts the file watcher for live sync.
 * @returns {import('chokidar').FSWatcher}
 */
export function startWatcher() {
  const kjHome = getKjHome();
  const storiesGlob = join(kjHome, 'hu-stories', '*', 'batch.json');
  const sessionsGlob = join(kjHome, 'sessions', '*', 'session.json');

  const watcher = watch([storiesGlob, sessionsGlob], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on('add', (path) => {
    console.log(`[watcher] New file: ${path}`);
    if (path.includes('hu-stories')) syncStoryFile(path);
    else if (path.includes('sessions')) syncSessionFile(path);
  });

  watcher.on('change', (path) => {
    console.log(`[watcher] Changed: ${path}`);
    if (path.includes('hu-stories')) syncStoryFile(path);
    else if (path.includes('sessions')) syncSessionFile(path);
  });

  console.log(`[watcher] Watching ${kjHome} for changes`);
  return watcher;
}
