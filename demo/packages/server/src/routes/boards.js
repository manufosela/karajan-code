import { Router } from 'express';
import { createBoardSchema, updateBoardSchema, ERROR_CODES } from '@taskboard/shared';
import { validate } from '../middleware/validate.js';
import * as boardsDb from '../db/queries/boards.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Router}
 */
export function boardRoutes(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const boards = boardsDb.listBoards(db, req.user.id);
    res.json({ boards });
  });

  router.post('/', validate(createBoardSchema), (req, res) => {
    const board = boardsDb.createBoard(db, {
      title: req.body.title,
      ownerId: req.user.id,
    });
    res.status(201).json({ board });
  });

  router.get('/:id', (req, res) => {
    const board = boardsDb.getBoard(db, req.params.id, req.user.id);
    if (!board) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Board not found',
      });
    }
    res.json({ board });
  });

  router.put('/:id', validate(updateBoardSchema), (req, res) => {
    const updated = boardsDb.updateBoard(
      db, req.params.id, req.user.id, { title: req.body.title }
    );
    if (!updated) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Board not found',
      });
    }
    res.json({ message: 'Board updated' });
  });

  router.delete('/:id', (req, res) => {
    const deleted = boardsDb.deleteBoard(db, req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Board not found',
      });
    }
    res.json({ message: 'Board deleted' });
  });

  return router;
}
