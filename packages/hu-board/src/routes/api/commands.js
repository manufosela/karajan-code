// KJC-TSK-0541: the kj commands the board launches, their run logs and the retired `kj run`
// routes, composed by routes/api.js.
import { Router } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { getHuBoardRunsDir } from '../../db.js';
import { runKjCommand, listSupportedCommands } from '../../command-runner.js';
import { pathExists } from '../../plans-service.js';

const router = Router();

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

export default router;
