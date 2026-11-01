import { Router } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import {
  getDashboardStats,
  getProjects,
  getKjHome,
  getHuBoardRunsDir,
} from '../db.js';
import { fullScan } from '../sync.js';
import { markPlanReady } from '../plan-mutations.js';
import { subscribe as subscribeEvents } from '../event-bus.js';
import { runKjCommand, listSupportedCommands } from '../command-runner.js';
import { readConfig, writeConfigPatch } from '../config-yaml.js';
import { requestProjectDir } from '../project-dir.js';
import { BOOT_TIME, PKG_VERSION } from '../boot-info.js';
import { addTombstone, isTombstoned as isTombstonedFn, removeTombstone, listTombstones } from '../db.js';
import { publish as publishEvent } from '../event-bus.js';
import { pathExists, findPlanFile } from '../plans-service.js';
import projectsRouter from './api/projects.js';
import storiesRouter from './api/stories.js';
import sessionsRouter from './api/sessions.js';

const router = Router();

/**
 * GET /api/version - Server version + boot timestamp.
 * The client polls this every 30s; if `boot_time` differs from the first
 * response, the server restarted and the client triggers a reload to pick
 * up any new HTML/JS (KJC-TSK-0379).
 */
router.get('/version', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: PKG_VERSION, boot_time: BOOT_TIME });
});

/**
 * GET /api/dashboard - Global dashboard statistics.
 */
router.get('/dashboard', (_req, res) => {
  try {
    const stats = getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// KJC-TSK-0541: project endpoints (list, detail, rename, is-test, preflight, plans-outcome,
// cost, delete, ready).
router.use(projectsRouter);

// KJC-TSK-0541: story endpoints (list, detail, edit, the refused delete) and session endpoints.
router.use(storiesRouter);
router.use(sessionsRouter);

/**
 * DELETE /api/prompts/:promptId - Discard a pending prompt the runner left
 * behind (KJC-TSK-0380). Removes the RPC files from disk, tombstones the
 * prompt id so a stale chokidar event can't recreate it, and emits a
 * `prompt:resolved` event so all open boards close the modal.
 */
router.delete('/prompts/:promptId', async (req, res) => {
  try {
    const promptId = req.params.promptId;
    const dir = promptsDir();
    const main = path.join(dir, `${promptId}.json`);
    const answer = path.join(dir, `${promptId}.answer.json`);
    let removed = 0;
    for (const p of [main, answer]) {
      try { await fsp.unlink(p); removed++; } catch { /* missing is fine */ }
    }
    addTombstone('prompt', promptId, { source: 'api', fsPaths: [main, answer] });
    // Re-use the same event the runner emits when answered, so any open
    // modal in any connected board client closes itself.
    publishEvent({ type: 'prompt-resolved', promptId });
    res.json({ deleted: true, filesRemoved: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/plans/:planId - Delete a single plan file.
 *
 * Removes `~/.kj/plans/<projectSlug>/plan-<planId>.json` and tombstones
 * the plan id so the next watcher event doesn't re-sync it. Does NOT
 * delete the project: a project can have multiple plans, deleting one
 * plan only removes that plan's HUs from the board.
 */
router.delete('/plans/:planId', async (req, res) => {
  try {
    const planId = req.params.planId;
    // Locate the plan file by scanning both canonical and legacy plans
    // roots — KJC-BUG-0059 (v2.19.3). Pre-fix this hard-coded
    // `getKjHome()/../.kj/plans` which silently misses plans saved by
    // post-2.19.0 callers under `~/.karajan/plans/`.
    let foundPath = null;
    try {
      foundPath = await findPlanFile(planId);
    } catch { /* plansRoot missing */ }
    addTombstone('plan', planId, { source: 'api', fsPaths: foundPath ? [foundPath] : [] });
    if (foundPath) { try { await fsp.unlink(foundPath); } catch { /* */ } }
    res.json({ deleted: true, fileRemoved: !!foundPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tombstones - List every active tombstone for diagnostics.
 *
 * Returns rows ordered by deleted_at DESC; useful for the diagnostics
 * pane and for the cleanup script (KJC-TSK-0380 PR-C).
 */
router.get('/tombstones', (_req, res) => {
  try {
    res.json(listTombstones());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tombstones/:type/:id/restore - Bring a buried id back to
 * life. The next sync will then re-import the resource if its filesystem
 * source still exists. Idempotent: returns false when nothing to remove.
 */
router.post('/tombstones/:type/:id/restore', (req, res) => {
  try {
    const removed = removeTombstone(req.params.type, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Tombstone not found' });
    res.json({ restored: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/plans/:planId/ready - Bulk-certify every pending HU of a plan.
 * Equivalent to the CLI `kj plan ready <planId>`. Body is optional — if the
 * client knows the projectId we use it as a fast path, otherwise we fall
 * back to scanning the plans dir.
 */
router.post('/plans/:planId/ready', (req, res) => {
  try {
    const { projectId } = req.body || {};
    const result = markPlanReady({ planId: req.params.planId, projectId });
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json({ ready: true, planId: req.params.planId, count: result.count, planStatus: result.planStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Resolve the prompts directory the runner writes RPC packets to.
 * Same convention as src/utils/board-prompt-bridge.js on the runner.
 */
function promptsDir() {
  return path.join(getKjHome(), 'prompts');
}

/**
 * GET /api/prompts - List currently pending prompts. The runner is
 * blocked on each one waiting for an answer; the board reads this on
 * boot to surface modals for prompts that were already pending when
 * the page loaded (the SSE event fires only on new arrivals).
 */
// KJC-BUG-0038: prompts whose runner crashed leave the .json behind in
// ~/.kj/prompts/. Without a TTL, every board reload re-shows the zombie
// modal "Karajan needs an answer" with no runner behind it — the user
// can answer but nothing happens. 30 minutes covers the longest legitimate
// Solomon escalation; anything older is a crashed runner.
const PROMPT_ZOMBIE_TTL_MS = 30 * 60 * 1000;

router.get('/prompts', async (_req, res) => {
  try {
    const dir = promptsDir();
    if (!(await pathExists(dir))) return res.json([]);
    const entries = await fsp.readdir(dir);
    const result = [];
    const now = Date.now();
    for (const name of entries) {
      if (!name.endsWith('.json') || name.endsWith('.answer.json')) continue;
      const promptId = name.replace(/\.json$/, '');
      const mainPath = path.join(dir, name);
      const answerPath = path.join(dir, `${promptId}.answer.json`);
      // KJC-TSK-0380 — skip tombstoned prompts and clean their files.
      if (isTombstonedFn('prompt', promptId)) {
        try { await fsp.unlink(mainPath); } catch { /* */ }
        try { await fsp.unlink(answerPath); } catch { /* */ }
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(await fsp.readFile(mainPath, 'utf-8'));
      } catch { continue; /* malformed — skip */ }
      // KJC-BUG-0038: zombie detection. Prefer parsed.createdAt; fall back
      // to mtime if the runner skipped the timestamp (older formats).
      const createdMs = Date.parse(parsed?.createdAt || '');
      const ageRef = Number.isFinite(createdMs) ? createdMs : await safeMtime(mainPath);
      if (ageRef && (now - ageRef) > PROMPT_ZOMBIE_TTL_MS) {
        try { await fsp.unlink(mainPath); } catch { /* */ }
        try { await fsp.unlink(answerPath); } catch { /* */ }
        addTombstone('prompt', promptId, { source: 'zombie-ttl', fsPaths: [mainPath, answerPath] });
        continue;
      }
      result.push(parsed);
    }
    result.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function safeMtime(p) {
  try { return (await fsp.stat(p)).mtimeMs; } catch { return 0; }
}

/**
 * POST /api/prompts/:promptId/answer - Body { answer }. Writes a
 * sibling .answer.json the runner is polling for. The runner reads
 * it, deletes both files, and resolves askQuestion. An answer of
 * "stop" tells the runner to abort the session.
 */
router.post('/prompts/:promptId/answer', async (req, res) => {
  try {
    const { answer } = req.body || {};
    if (typeof answer !== 'string') {
      return res.status(400).json({ error: 'Body must contain an "answer" string' });
    }
    const dir = promptsDir();
    await fsp.mkdir(dir, { recursive: true });
    const promptPath = path.join(dir, `${req.params.promptId}.json`);
    if (!(await pathExists(promptPath))) {
      return res.status(404).json({ error: `Prompt not found: ${req.params.promptId}` });
    }
    const answerPath = path.join(dir, `${req.params.promptId}.answer.json`);
    await fsp.writeFile(
      answerPath,
      JSON.stringify({ answer, answeredAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/events - Server-Sent Events stream for live board updates.
 *
 * Replaces the old "sync → full page re-render" dance. The chokidar
 * watcher publishes a small event on every sync (plan/session/batch);
 * this endpoint pipes those events to every connected client. The
 * client patches the affected card in place, so scroll position and
 * any open modal survive the update.
 *
 * The connection stays open for the life of the tab. Browsers
 * auto-reconnect on socket drop — we send a keep-alive comment every
 * 25s so intermediate proxies don't kill the idle socket.
 */
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable Express compression on this route — SSE must be a raw
    // stream, gzip buffers and breaks the "push on every event" model.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // Initial hello so the client knows the stream is open. Useful for
  // the integration test too: the EventSource-equivalent supertest
  // client can wait on the first line.
  res.write('retry: 2000\n');
  res.write('event: hello\ndata: {"ok":true}\n\n');

  const send = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client gone — the close handler will clean up shortly.
    }
  };
  const unsubscribe = subscribeEvents(send);

  // 25s is well under the default 60-90s idle timeout of every sane
  // reverse proxy, but high enough that it doesn't spam the log.
  const keepAlive = setInterval(() => {
    try { res.write(': keep-alive\n\n'); } catch { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end?.();
  });
});

/**
 * KJC-TSK-1319: the board launched `kj run` for a plan, an HU or a whole
 * project. kj run is retired in 5.0 (your agent does the work, kj governs
 * it), so these routes say so and launch nothing. The board never imports
 * the CLI tree (KJC-TSK-0632): the notice lives here.
 */
const RUN_RETIRED = {
  error: 'kj run was retired in 5.0. Your agent (Claude Code, OpenCode...) does the work now and kj governs it: split the task with kj brief planner + kj hu add, one lane per card with kj worktree start, and kj review --staged before every commit.',
  guide: 'https://github.com/manufosela/karajan-code/blob/main/MIGRATION-v5.md',
};
router.post(['/plans/:planId/run', '/hus/:huId/run', '/projects/:id/run'], (_req, res) => {
  res.status(410).json(RUN_RETIRED);
});

/**
 * GET /api/config — read the editable subset of the kj.config.yml.
 * Powers the board's settings modal; non-editable keys in the yml are
 * left untouched on PUT (see writeConfigPatch's whitelist semantics).
 *
 * v2.30.0 PR4 — supports `?scope=global|project`:
 *   - `global` (default): reads ~/.karajan/kj.config.yml.
 *   - `project`: reads <projectDir>/.karajan/kj.config.yml.
 * Unknown scopes are 400'd. Response includes the resolved `scope` and
 * `path` so the UI can show which file backs the current view.
 */
router.get('/config', (req, res) => {
  try {
    const scope = req.query?.scope || 'global';
    // KJC-TSK-0885: a scoped view names its project; the daemon's cwd is not it.
    const data = readConfig({ scope, projectDir: requestProjectDir(req.query?.project) });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /api/config — apply a patch to the yml. Body is
 * `{ patch: { key: value }, scope?: 'global'|'project' }` with the keys
 * defined in EDITABLE_FIELDS. Unknown keys are 400'd; type errors are
 * 400'd; validation errors are 400'd. Writes are atomic (tmp + rename)
 * and a `.bak` is kept of the previous content.
 *
 * v2.30.0 PR4 — `scope` decides which file is patched. Default 'global'
 * preserves the previous behavior.
 */
router.put('/config', (req, res) => {
  try {
    const patch = req.body?.patch;
    const scope = req.body?.scope || 'global';
    let projectDir;
    try { projectDir = requestProjectDir(req.body?.project); } catch (err) { return res.status(400).json({ error: err.message }); }
    const result = writeConfigPatch(patch, { scope, projectDir });
    if (!result.written) {
      return res.status(400).json({ error: 'No se pudo guardar la configuración', details: result });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/commands - List the kj commands the board can launch.
 * The UI uses this to render the Actions panel without hardcoding
 * the command list on the client.
 */
router.get('/commands', (_req, res) => {
  res.json({ commands: listSupportedCommands() });
});

/**
 * POST /api/commands/:command - Spawn a kj <command> as a detached
 * child. Body fields depend on the command (see command-runner.js
 * for the per-command input schema). Returns a commandId the client
 * can pass to GET /api/runs/:commandId/log to tail the output.
 *
 * The board never executes free-form arg arrays — the command name
 * must be in the whitelist and each command builds its argv from a
 * typed schema. Anything outside that fails 400.
 */
router.post('/commands/:command', (req, res) => {
  try {
    const result = runKjCommand({ command: req.params.command, input: req.body || {} });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({
      ok: true,
      commandId: result.commandId,
      pid: result.pid,
      logPath: result.logPath,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/runs/:commandId/log - Generalisation of the per-plan log
 * tail. The original `/api/plans/:planId/log` reads
 * `<runsDir>/<planId>.log`; this one reads `<runsDir>/<commandId>.log`
 * where `commandId` is what `/api/commands/:command` returned.
 *
 * Same offset semantics + 1 MiB cap as the plans endpoint.
 */
router.get('/runs/:commandId/log', async (req, res) => {
  try {
    const runsDir = getHuBoardRunsDir(); // KJC-TSK-0421
    const logPath = path.join(runsDir, `${req.params.commandId}.log`);
    if (!(await pathExists(logPath))) {
      return res.json({ exists: false, size: 0, content: '' });
    }
    const stat = await fsp.stat(logPath);
    const offset = Math.max(0, Math.min(stat.size, Number(req.query.offset) || 0));
    const MAX_READ = 1024 * 1024;
    const length = Math.min(MAX_READ, stat.size - offset);
    let content = '';
    if (length > 0) {
      const fh = await fsp.open(logPath, 'r');
      try {
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, offset);
        content = buf.toString('utf-8');
      } finally {
        await fh.close();
      }
    }
    res.json({ exists: true, size: stat.size, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/board/restart - Respawn the board server in place. The
 * server can't truly restart itself (it'd kill its own process), so
 * we use the detached-child + parent-exit pattern: spawn a copy with
 * the same argv + cwd + env, unref it, ack the client, then exit
 * after a 250 ms delay so the response actually flushes.
 *
 * The new server overwrites the PID file and bindes the same port
 * (or the next free one if the old one hasn't released yet — handled
 * by the existing find-available-port logic in startBoard).
 *
 * The browser tab's EventSource auto-reconnects, so the user sees a
 * brief blip and the board comes back live.
 */
/**
 * POST /api/board/shutdown - Tell the server to exit cleanly. Used
 * by `kj board stop` as a fallback when the PID file is missing or
 * stale (typical after the user has been hot-pulling Karajan and
 * the running server is from a build that didn't write the PID
 * file). The body of the response is sent before we exit, then a
 * 250 ms delay to let the response flush, then process.exit(0).
 */
router.post('/board/shutdown', (_req, res) => {
  if (process.env.KJ_BOARD_RESTART_MODE === 'echo') {
    return res.json({ ok: true, mode: 'echo' });
  }
  res.json({ ok: true, shuttingDownInMs: 250 });
  setTimeout(() => process.exit(0), 250);
});

router.post('/board/restart', (_req, res) => {
  // Tests / programmatic callers can short-circuit the actual self-
  // exec via env so the suite doesn't have its node process killed
  // mid-test by a misfire.
  if (process.env.KJ_BOARD_RESTART_MODE === 'echo') {
    return res.json({ ok: true, restartingInMs: 0, mode: 'echo' });
  }
  try {
    res.json({ ok: true, restartingInMs: 250 });
    setTimeout(() => {
      try {
        const child = spawnChild(
          process.execPath,
          process.argv.slice(1),
          { cwd: process.cwd(), detached: true, stdio: 'ignore', env: process.env }
        );
        child.unref();
      } catch { /* if respawn fails, the user can `kj board start` manually */ }
      process.exit(0);
    }, 250);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sync - Force a full re-scan of the plans and sessions/ on disk.
 * Useful when chokidar's file watcher misses new subdirectories created after
 * the board started (known limitation with glob patterns).
 */
router.post('/sync', (_req, res) => {
  try {
    fullScan();
    const projects = getProjects();
    res.json({ synced: true, projects: projects.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/rag/query - Semantic search over the indexed RAG corpus
 * (KJC-PCS-0049 Step 8). Body: { text, topK?, scope? }. Response:
 * { hits: [...], empty, topK, scope }. Empty store carries empty=true
 * so the UI can show an actionable hint instead of just empty results.
 */
router.post('/rag/query', async (req, res) => {
  const { text, topK = 5, scope = 'all' } = req.body || {};
  if (typeof text !== 'string' || text.length === 0) {
    return res.status(400).json({ error: "'text' is required (non-empty string)" });
  }
  // KJC-TSK-0885 (ADR 0011): a scoped view searches ITS project's index; the
  // machine-wide store (no filter) returned chunks of any repo.
  let projectDir;
  try { projectDir = requestProjectDir(req.body?.project); } catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    const { openVecStore, countChunks } = await import('karajan-core/vec-store');
    // KJC-TSK-0632: resolved from karajan-core — the board carries zero
    // relative imports into the CLI src tree (see no-cli-imports test).
    const { makeEmbedder } = await import('karajan-core/rag/embedders/factory');
    const { query } = await import('karajan-core/rag/retriever');
    const db = openVecStore({ dim: 768, ...(projectDir ? { path: path.join(projectDir, '.karajan', 'rag.db') } : {}) });
    try {
      if (countChunks(db) === 0) return res.json({ hits: [], empty: true, topK, scope });
      const embedder = makeEmbedder({});
      const hits = await query(db, embedder, text, { topK: Number(topK), scope });
      res.json({ hits, empty: false, topK, scope });
    } finally { db.close(); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
