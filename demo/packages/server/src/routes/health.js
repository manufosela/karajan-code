import { Router } from 'express';

const startTime = Date.now();

/**
 * @returns {Router}
 */
export function healthRoutes() {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
