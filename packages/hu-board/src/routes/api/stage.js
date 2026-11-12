// KJC-TSK-1405 (ADR 0046): what kj stage shows on open, per project.
import { Router } from 'express';

import { getKjHome } from '../../db-paths.js';
import { lanePipelines } from '../../lane-pipeline.js';
import { readAvatar, saveAvatar } from '../../stage-avatar.js';
import { requestProjectDir } from '../../project-dir.js';
import { stageMap } from '../../stage-map.js';
import { laneStates } from '../../stage-state.js';
import { withTeam } from '../../stage-team.js';

const router = Router();

/** GET /api/stage/state?project=<slug> - the last denial, verdict and seal. */
router.get('/stage/state', async (req, res) => {
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
  // HU-4029: the pipeline of each lane's open pull request, read from gh without holding the server.
  const pipelines = await lanePipelines(dir);
  // KJC-TSK-1432 (ADR 0048): every lane; the main checkout's state stays at the top until the scene draws the lanes.
  // KJC-TSK-1564 (ADR 0056): and the teammates' cards in progress, lanes of the same factory.
  const lanes = withTeam(dir, laneStates(dir, { readers: { pipeline: ({ dir: laneDir }) => pipelines.get(laneDir) ?? null } }));
  const { lane: _main, ...main } = lanes[0];
  res.json({ ...main, lanes });
});

/** GET/PUT /api/stage/me - KJC-TSK-1565 (ADR 0056): this person's avatar, an emblem and a colour per role. */
router.get('/stage/me', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(readAvatar(getKjHome()));
});
router.put('/stage/me', (req, res) => {
  try { res.json(saveAvatar(getKjHome(), req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/stage/map - KJC-TSK-1446 (ADR 0049): every factory of the user with the state of its lanes. */
router.get('/stage/map', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(stageMap()); } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
