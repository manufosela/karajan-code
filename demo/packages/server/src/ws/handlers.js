import { WS_EVENTS } from '@taskboard/shared';
import * as cardsDb from '../db/queries/cards.js';
import * as columnsDb from '../db/queries/columns.js';
import { logger } from '../logger.js';

/**
 * Handle an incoming WebSocket message.
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.db
 * @param {import('./broadcast.js').BroadcastManager} params.broadcast
 * @param {import('ws').WebSocket} params.ws
 * @param {string} params.userId
 * @param {{ type: string, payload?: Record<string, unknown> }} params.message
 */
export function handleMessage({ db, broadcast, ws, userId, message }) {
  const { type, payload } = message;

  const handlers = {
    [WS_EVENTS.JOIN_BOARD]: () => handleJoinBoard({ broadcast, ws, payload }),
    [WS_EVENTS.LEAVE_BOARD]: () => handleLeaveBoard({ broadcast, ws, payload }),
    [WS_EVENTS.CARD_CREATE]: () => handleCardCreate({ db, broadcast, ws, payload }),
    [WS_EVENTS.CARD_UPDATE]: () => handleCardUpdate({ db, broadcast, ws, payload }),
    [WS_EVENTS.CARD_DELETE]: () => handleCardDelete({ db, broadcast, ws, payload }),
    [WS_EVENTS.CARD_MOVE]: () => handleCardMove({ db, broadcast, ws, payload }),
    [WS_EVENTS.COLUMN_CREATE]: () => handleColumnCreate({ db, broadcast, ws, payload }),
    [WS_EVENTS.COLUMN_UPDATE]: () => handleColumnUpdate({ db, broadcast, ws, payload }),
    [WS_EVENTS.COLUMN_DELETE]: () => handleColumnDelete({ db, broadcast, ws, payload }),
  };

  const handler = handlers[type];
  if (!handler) {
    sendError(ws, `Unknown event type: ${type}`);
    return;
  }

  try {
    handler();
  } catch (err) {
    logger.error({ err, type, userId }, 'WS handler error');
    sendError(ws, 'Internal error processing message');
  }
}

function handleJoinBoard({ broadcast, ws, payload }) {
  broadcast.join(payload.boardId, ws);
}

function handleLeaveBoard({ broadcast, ws, payload }) {
  broadcast.leave(payload.boardId, ws);
}

function handleCardCreate({ db, broadcast, ws, payload }) {
  const card = cardsDb.createCard(db, {
    columnId: payload.columnId,
    title: payload.title,
    description: payload.description,
  });
  const column = columnsDb.getColumn(db, payload.columnId);
  broadcast.broadcast(column.board_id, {
    type: WS_EVENTS.CARD_CREATE,
    payload: card,
  }, ws);
}

function handleCardUpdate({ db, broadcast, ws, payload }) {
  cardsDb.updateCard(db, payload.id, {
    title: payload.title,
    description: payload.description,
  });
  const card = cardsDb.getCard(db, payload.id);
  const column = columnsDb.getColumn(db, card.column_id);
  broadcast.broadcast(column.board_id, {
    type: WS_EVENTS.CARD_UPDATE,
    payload: card,
  }, ws);
}

function handleCardDelete({ db, broadcast, ws, payload }) {
  const card = cardsDb.getCard(db, payload.id);
  if (!card) return;
  const column = columnsDb.getColumn(db, card.column_id);
  cardsDb.deleteCard(db, payload.id);
  broadcast.broadcast(column.board_id, {
    type: WS_EVENTS.CARD_DELETE,
    payload: { id: payload.id },
  }, ws);
}

function handleCardMove({ db, broadcast, ws, payload }) {
  const card = cardsDb.getCard(db, payload.id);
  if (!card) return;
  const oldColumn = columnsDb.getColumn(db, card.column_id);
  const result = cardsDb.moveCard(db, payload.id, {
    columnId: payload.columnId,
    position: payload.position,
  });
  broadcast.broadcast(oldColumn.board_id, {
    type: WS_EVENTS.CARD_MOVE,
    payload: result,
  }, ws);
}

function handleColumnCreate({ db, broadcast, ws, payload }) {
  const column = columnsDb.createColumn(db, {
    boardId: payload.boardId,
    title: payload.title,
    position: payload.position,
  });
  broadcast.broadcast(payload.boardId, {
    type: WS_EVENTS.COLUMN_CREATE,
    payload: column,
  }, ws);
}

function handleColumnUpdate({ db, broadcast, ws, payload }) {
  columnsDb.updateColumn(db, payload.id, {
    title: payload.title,
    position: payload.position,
  });
  const column = columnsDb.getColumn(db, payload.id);
  broadcast.broadcast(column.board_id, {
    type: WS_EVENTS.COLUMN_UPDATE,
    payload: column,
  }, ws);
}

function handleColumnDelete({ db, broadcast, ws, payload }) {
  const column = columnsDb.getColumn(db, payload.id);
  if (!column) return;
  columnsDb.deleteColumn(db, payload.id);
  broadcast.broadcast(column.board_id, {
    type: WS_EVENTS.COLUMN_DELETE,
    payload: { id: payload.id },
  }, ws);
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {string} message
 */
function sendError(ws, message) {
  ws.send(JSON.stringify({ type: WS_EVENTS.ERROR, payload: { message } }));
}
