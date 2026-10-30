// KJC-TSK-1313: the worktree lanes working each card of a project, for the badge on the card.
// They come from `kj worktree list --json`: read from git every time, never stored, and the board
// stays decoupled from the CLI tree (KJC-TSK-0632). A failure is data for the view, never a 500.
import { Router } from 'express';
import { runCommand } from 'karajan-core/process';

import { requestProjectDir } from '../project-dir.js';

const router = Router();

router.get('/:project', async (req, res) => {
  const { project } = req.params;
  try {
    const dir = requestProjectDir(project);
    const r = await runCommand('kj', ['worktree', 'list', '--json'], { cwd: dir });
    const line = String(r.stdout || '').trim().split('\n').findLast((l) => l.startsWith('['));
    if (r.exitCode !== 0 || !line) return res.json({ byStory: {}, error: `kj worktree list --json failed (exit ${r.exitCode})` });
    const byStory = {};
    for (const lane of JSON.parse(line)) {
      // Story ids on the board are `<project>::<hu id>` (sync.js).
      for (const card of lane.cards) {
        const key = `${project}::${card}`;
        byStory[key] ??= [];
        byStory[key].push(lane);
      }
    }
    return res.json({ byStory });
  } catch (err) {
    return res.json({ byStory: {}, error: String(err.message || err) });
  }
});

export default router;
