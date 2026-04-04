import { describe, it, expect, vi } from 'vitest';
import { BroadcastManager } from '../../src/ws/broadcast.js';

function mockWs(readyState = 1) {
  return { readyState, send: vi.fn() };
}

describe('BroadcastManager', () => {
  it('broadcasts to all clients in a room except sender', () => {
    const bm = new BroadcastManager();
    const ws1 = mockWs();
    const ws2 = mockWs();
    const ws3 = mockWs();

    bm.join('board-1', ws1);
    bm.join('board-1', ws2);
    bm.join('board-1', ws3);

    bm.broadcast('board-1', { type: 'test' }, ws1);

    expect(ws1.send).not.toHaveBeenCalled();
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
    expect(ws3.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
  });

  it('does not send to clients in other rooms', () => {
    const bm = new BroadcastManager();
    const ws1 = mockWs();
    const ws2 = mockWs();

    bm.join('board-1', ws1);
    bm.join('board-2', ws2);

    bm.broadcast('board-1', { type: 'test' });

    expect(ws1.send).toHaveBeenCalled();
    expect(ws2.send).not.toHaveBeenCalled();
  });

  it('handles leave correctly', () => {
    const bm = new BroadcastManager();
    const ws1 = mockWs();
    const ws2 = mockWs();

    bm.join('board-1', ws1);
    bm.join('board-1', ws2);
    bm.leave('board-1', ws1);

    bm.broadcast('board-1', { type: 'test' });
    expect(ws1.send).not.toHaveBeenCalled();
    expect(ws2.send).toHaveBeenCalled();
  });

  it('leaveAll removes client from all rooms', () => {
    const bm = new BroadcastManager();
    const ws1 = mockWs();

    bm.join('board-1', ws1);
    bm.join('board-2', ws1);
    bm.leaveAll(ws1);

    bm.broadcast('board-1', { type: 'test' });
    bm.broadcast('board-2', { type: 'test' });
    expect(ws1.send).not.toHaveBeenCalled();
  });

  it('skips clients with non-open readyState', () => {
    const bm = new BroadcastManager();
    const wsOpen = mockWs(1);
    const wsClosed = mockWs(3);

    bm.join('board-1', wsOpen);
    bm.join('board-1', wsClosed);

    bm.broadcast('board-1', { type: 'test' });
    expect(wsOpen.send).toHaveBeenCalled();
    expect(wsClosed.send).not.toHaveBeenCalled();
  });
});
