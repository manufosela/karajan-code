import { Router } from 'express';
import { createCardSchema, updateCardSchema, moveCardSchema, ERROR_CODES } from '@taskboard/shared';
import { validate } from '../middleware/validate.js';
import * as cardsDb from '../db/queries/cards.js';
import * as columnsDb from '../db/queries/columns.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Router}
 */
export function cardRoutes(db) {
  const router = Router();

  // List cards in a column
  router.get('/columns/:columnId/cards', (req, res) => {
    const column = columnsDb.getColumn(db, req.params.columnId);
    if (!column) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Column not found',
      });
    }
    const cards = cardsDb.listCards(db, req.params.columnId);
    res.json({ cards });
  });

  // Create card in a column
  router.post('/columns/:columnId/cards', validate(createCardSchema), (req, res) => {
    const column = columnsDb.getColumn(db, req.params.columnId);
    if (!column) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Column not found',
      });
    }
    const card = cardsDb.createCard(db, {
      columnId: req.params.columnId,
      title: req.body.title,
      description: req.body.description,
      position: req.body.position,
    });
    res.status(201).json({ card });
  });

  // Update card
  router.put('/cards/:id', validate(updateCardSchema), (req, res) => {
    const updated = cardsDb.updateCard(db, req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Card not found',
      });
    }
    res.json({ message: 'Card updated' });
  });

  // Move card (drag & drop)
  router.patch('/cards/:id/move', validate(moveCardSchema), (req, res) => {
    const result = cardsDb.moveCard(db, req.params.id, {
      columnId: req.body.columnId,
      position: req.body.position,
    });
    if (!result) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Card not found',
      });
    }
    res.json({ card: result });
  });

  // Delete card
  router.delete('/cards/:id', (req, res) => {
    const deleted = cardsDb.deleteCard(db, req.params.id);
    if (!deleted) {
      return res.status(404).json({
        error: ERROR_CODES.NOT_FOUND,
        message: 'Card not found',
      });
    }
    res.json({ message: 'Card deleted' });
  });

  return router;
}
