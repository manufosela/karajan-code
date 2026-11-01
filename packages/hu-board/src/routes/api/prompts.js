// KJC-TSK-0541: the prompt endpoints of /api (questions the runner leaves for the board),
// composed by routes/api.js.
import { Router } from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { getKjHome, addTombstone, isTombstoned as isTombstonedFn } from '../../db.js';
import { publish as publishEvent } from '../../event-bus.js';
import { pathExists } from '../../plans-service.js';

const router = Router();

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

export default router;
