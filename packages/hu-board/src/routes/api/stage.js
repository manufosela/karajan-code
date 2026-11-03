// KJC-TSK-1405 (ADR 0046): what kj stage shows on open, per project.
import { Router } from 'express';

import { requestProjectDir } from '../../project-dir.js';
import { lastStageState } from '../../stage-state.js';

const router = Router();

/** GET /api/stage/state?project=<slug> - the last denial, verdict and seal. */
router.get('/stage/state', (req, res) => {
  let dir;
  try { dir = requestProjectDir(req.query.project); } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (!dir) {
    res.status(400).json({ error: 'the stage needs a project: /api/stage/state?project=<slug>' });
    return;
  }
  res.set('Cache-Control', 'no-store');
  res.json(lastStageState(dir));
});

export default router;
