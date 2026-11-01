// The /api root of the board (KJC-TSK-0541): it only composes the routers of each resource,
// so server.js mounts one router and every test that mounts it reaches every endpoint.
import { Router } from 'express';
import systemRouter from './api/system.js';
import projectsRouter from './api/projects.js';
import storiesRouter from './api/stories.js';
import sessionsRouter from './api/sessions.js';
import promptsRouter from './api/prompts.js';
import plansRouter from './api/plans.js';
import tombstonesRouter from './api/tombstones.js';
import commandsRouter from './api/commands.js';

const router = Router();

// Version, dashboard, live events, config, restart and shutdown, sync, RAG search.
router.use(systemRouter);

// Projects: list, detail, rename, is-test, preflight, plans-outcome, cost, delete, ready.
router.use(projectsRouter);

// Stories (list, detail, edit, the refused delete) and sessions.
router.use(storiesRouter);
router.use(sessionsRouter);

// Prompts the runner leaves for the board: list, answer, discard.
router.use(promptsRouter);

// Plans (delete, ready) and tombstones (list, restore).
router.use(plansRouter);
router.use(tombstonesRouter);

// The kj commands the board launches, their run logs and the retired `kj run` routes.
router.use(commandsRouter);

export default router;
