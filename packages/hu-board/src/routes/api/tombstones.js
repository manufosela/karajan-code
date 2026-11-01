// KJC-TSK-0541: the tombstone endpoints of /api (deleted ids the sync must not bring back),
// composed by routes/api.js.
import { Router } from 'express';

import { removeTombstone, listTombstones } from '../../db.js';

const router = Router();

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

export default router;
