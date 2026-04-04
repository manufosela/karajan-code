import { logger } from '../logger.js';

/**
 * Room-based client registry for WebSocket broadcasting.
 */
export class BroadcastManager {
  constructor() {
    /** @type {Map<string, Set<import('ws').WebSocket>>} */
    this.rooms = new Map();
  }

  /**
   * Add a client to a board room.
   * @param {string} boardId
   * @param {import('ws').WebSocket} ws
   */
  join(boardId, ws) {
    if (!this.rooms.has(boardId)) {
      this.rooms.set(boardId, new Set());
    }
    this.rooms.get(boardId).add(ws);
    logger.debug({ boardId }, 'Client joined room');
  }

  /**
   * Remove a client from a board room.
   * @param {string} boardId
   * @param {import('ws').WebSocket} ws
   */
  leave(boardId, ws) {
    const room = this.rooms.get(boardId);
    if (!room) return;
    room.delete(ws);
    if (room.size === 0) this.rooms.delete(boardId);
  }

  /**
   * Remove a client from all rooms.
   * @param {import('ws').WebSocket} ws
   */
  leaveAll(ws) {
    for (const [boardId, room] of this.rooms) {
      room.delete(ws);
      if (room.size === 0) this.rooms.delete(boardId);
    }
  }

  /**
   * Send a message to all clients in a room except the sender.
   * @param {string} boardId
   * @param {object} message
   * @param {import('ws').WebSocket} [exclude]
   */
  broadcast(boardId, message, exclude) {
    const room = this.rooms.get(boardId);
    if (!room) return;

    const data = JSON.stringify(message);
    for (const client of room) {
      if (client !== exclude && client.readyState === 1) {
        client.send(data);
      }
    }
  }
}
