import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleMessage } from '../../src/ws/handlers.js';
import { BroadcastManager } from '../../src/ws/broadcast.js';
import { createTestDb, seedUser, seedBoard, seedColumn, seedCard } from '../helpers.js';

describe('WS message handlers', () => {
  let db, broadcast, ws;

  beforeEach(async () => {
    db = createTestDb();
    broadcast = new BroadcastManager();
    ws = { send: vi.fn(), readyState: 1 };
  });

  afterEach(() => db.close());

  it('handles join:board', async () => {
    const joinSpy = vi.spyOn(broadcast, 'join');
    handleMessage({
      db, broadcast, ws, userId: 'u1',
      message: { type: 'join:board', payload: { boardId: 'b1' } },
    });
    expect(joinSpy).toHaveBeenCalledWith('b1', ws);
  });

  it('handles card:create and broadcasts', async () => {
    const seeded = await seedUser(db);
    const board = seedBoard(db, seeded.user.id);
    const col = seedColumn(db, board.id);

    const broadcastSpy = vi.spyOn(broadcast, 'broadcast');

    handleMessage({
      db, broadcast, ws, userId: seeded.user.id,
      message: {
        type: 'card:create',
        payload: { columnId: col.id, title: 'WS Card', description: '' },
      },
    });

    expect(broadcastSpy).toHaveBeenCalledWith(
      board.id,
      expect.objectContaining({ type: 'card:create' }),
      ws
    );
  });

  it('handles card:delete', async () => {
    const seeded = await seedUser(db);
    const board = seedBoard(db, seeded.user.id);
    const col = seedColumn(db, board.id);
    const card = seedCard(db, col.id);

    const broadcastSpy = vi.spyOn(broadcast, 'broadcast');

    handleMessage({
      db, broadcast, ws, userId: seeded.user.id,
      message: { type: 'card:delete', payload: { id: card.id } },
    });

    expect(broadcastSpy).toHaveBeenCalledWith(
      board.id,
      expect.objectContaining({ type: 'card:delete' }),
      ws
    );
  });

  it('sends error for unknown event type', () => {
    handleMessage({
      db, broadcast, ws, userId: 'u1',
      message: { type: 'unknown:event', payload: {} },
    });
    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('Unknown event type')
    );
  });
});
