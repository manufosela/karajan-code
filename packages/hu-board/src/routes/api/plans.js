// KJC-TSK-0541: the plan endpoints of /api, composed by routes/api.js.
import { Router } from 'express';
import fsp from 'node:fs/promises';

import { addTombstone } from '../../db.js';
import { markPlanReady } from '../../plan-mutations.js';
import { findPlanFile } from '../../plans-service.js';

const router = Router();

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

export default router;
