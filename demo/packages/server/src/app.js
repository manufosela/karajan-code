import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authMiddleware } from './auth/middleware.js';
import { authRoutes } from './routes/auth.js';
import { boardRoutes } from './routes/boards.js';
import { columnRoutes } from './routes/columns.js';
import { cardRoutes } from './routes/cards.js';
import { healthRoutes } from './routes/health.js';
import { errorHandler } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';

/**
 * Create and configure the Express app.
 * @param {import('better-sqlite3').Database} db
 * @returns {express.Express}
 */
export function createApp(db) {
  const app = express();

  // Global middleware
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(rateLimit());

  // Public routes
  app.use('/api/health', healthRoutes());
  app.use('/api/auth', authRoutes(db));

  // Protected routes
  app.use('/api/boards', authMiddleware, boardRoutes(db));
  app.use('/api', authMiddleware, columnRoutes(db));
  app.use('/api', authMiddleware, cardRoutes(db));

  // Static files for the client
  app.use(express.static('packages/client'));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
