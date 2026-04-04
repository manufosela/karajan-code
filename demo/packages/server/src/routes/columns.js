import { Router } from 'express';
import { createColumnSchema, updateColumnSchema, ERROR_CODES } from '@taskboard/shared';
import { validate } from '../middleware/validate.js';
import * as columnsDb from '../db/queries/columns.js';
import * as boardsDb from '../db/queries/boards.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Router}
 */
export function columnRoutes(db) {
  const router = Router();

  // List columns for a board
  router.get('/boards/:boardId/columns', (req, res) => {
    const board = boardsDb.getBoard(db, req.params.boardId, req.user.id);
    if (!board) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Board not found',
      });
    }
    const columns = columnsDb.listColumns(db, req.params.boardId);
    res.json({ columns });
  });

  // Create column in a board
  router.post('/boards/:boardId/columns', validate(createColumnSchema), (req, res) => {
    const board = boardsDb.getBoard(db, req.params.boardId, req.user.id);
    if (!board) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Board not found',
      });
    }
    const column = columnsDb.createColumn(db, {
      boardId: req.params.boardId,
      title: req.body.title,
      position: req.body.position,
    });
    res.status(201).json({ column });
  });

  // Update column
  router.put('/columns/:id', validate(updateColumnSchema), (req, res) => {
    const updated = columnsDb.updateColumn(db, req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Column not found',
      });
    }
    res.json({ message: 'Column updated' });
  });

  // Delete column
  router.delete('/columns/:id', (req, res) => {
    const deleted = columnsDb.deleteColumn(db, req.params.id);
    if (!deleted) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Column not found',
      });
    }
    res.json({ message: 'Column deleted' });
  });

  return router;
}
