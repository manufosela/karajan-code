// KJC-TSK-1405 (ADR 0046): what kj stage shows on open, per project.
import { Router } from 'express';

import { requestProjectDir } from '../../project-dir.js';
import { laneStates } from '../../stage-state.js';

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
  // KJC-TSK-1432 (ADR 0048): every lane; the main checkout's state stays at the top until the scene draws the lanes.
  const lanes = laneStates(dir);
  const { lane: _main, ...main } = lanes[0];
  res.json({ ...main, lanes });
});

export default router;
