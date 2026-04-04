import { Router } from 'express';
import { registerSchema, loginSchema, ERROR_CODES } from '@taskboard/shared';
import { hashPassword, comparePassword } from '../auth/passwords.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/jwt.js';
import { createUser, findUserByEmail, findUserById } from '../db/queries/users.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../logger.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
};

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Router}
 */
export function authRoutes(db) {
  const router = Router();

  router.post('/register', validate(registerSchema), async (req, res) => {
    const { email, password } = req.body;

    const existing = findUserByEmail(db, email);
    if (existing) {
      return res.status(409).json({
        error: ERROR_CODES.CONFLICT,
        message: 'Email already registered',
      });
    }

    const passwordHash = await hashPassword(password);
    const user = createUser(db, { email, passwordHash });

    setAuthCookies(res, user);
    logger.info({ userId: user.id }, 'User registered');
    res.status(201).json({ user: { id: user.id, email: user.email } });
  });

  router.post('/login', validate(loginSchema), async (req, res) => {
    const { email, password } = req.body;

    const user = findUserByEmail(db, email);
    if (!user) {
      return res.status(401).json({
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid credentials',
      });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid credentials',
      });
    }

    setAuthCookies(res, user);
    logger.info({ userId: user.id }, 'User logged in');
    res.json({ user: { id: user.id, email: user.email } });
  });

  router.post('/refresh', (req, res) => {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      return res.status(401).json({
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Refresh token required',
      });
    }

    try {
      const decoded = verifyToken(refreshToken);
      if (decoded.type !== 'refresh') {
        throw new Error('Not a refresh token');
      }

      const user = findUserById(db, decoded.sub);
      if (!user) {
        throw new Error('User not found');
      }

      setAuthCookies(res, user);
      res.json({ user: { id: user.id, email: user.email } });
    } catch {
      return res.status(401).json({
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid refresh token',
      });
    }
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie('access_token', COOKIE_OPTIONS);
    res.clearCookie('refresh_token', COOKIE_OPTIONS);
    res.json({ message: 'Logged out' });
  });

  return router;
}

/**
 * @param {import('express').Response} res
 * @param {{ id: string, email: string }} user
 */
function setAuthCookies(res, user) {
  const accessToken = signAccessToken({ id: user.id, email: user.email });
  const refreshToken = signRefreshToken({ id: user.id });

  res.cookie('access_token', accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refresh_token', refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
