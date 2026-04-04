import { z } from 'zod';

/** Auth schemas */
export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Board schemas */
export const createBoardSchema = z.object({
  title: z.string().min(1).max(200).trim(),
});

export const updateBoardSchema = z.object({
  title: z.string().min(1).max(200).trim(),
});

/** Column schemas */
export const createColumnSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  position: z.number().int().min(0).optional(),
});

export const updateColumnSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  position: z.number().int().min(0).optional(),
});

/** Card schemas */
export const createCardSchema = z.object({
  title: z.string().min(1).max(500).trim(),
  description: z.string().max(5000).trim().default(''),
  position: z.number().int().min(0).optional(),
});

export const updateCardSchema = z.object({
  title: z.string().min(1).max(500).trim().optional(),
  description: z.string().max(5000).trim().optional(),
});

export const moveCardSchema = z.object({
  columnId: z.string().uuid(),
  position: z.number().int().min(0),
});

/** WebSocket message schema */
export const wsMessageSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});
