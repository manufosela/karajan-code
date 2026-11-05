// KJC-BUG-0499: what the board says when it starts never carries its token (it lands in hu-board.log).
import { describe, expect, it } from 'vitest';

import { startupBanner } from '../src/startup-banner.js';

const base = { pid: 42, port: 4000, dataDir: '~/.karajan', tokenPath: '/home/u/.karajan/hu-board/token' };

describe('startupBanner', () => {
  it('on loopback says where it runs and nothing about a token', () => {
    const text = startupBanner({ ...base, host: '127.0.0.1', isLoopback: true }).join('\n');
    expect(text).toContain('Running at: http://localhost:4000');
    expect(text).not.toMatch(/token/i);
  });

  it('off loopback says a token is required and where to read it, never the token nor a URL with it', () => {
    const lines = startupBanner({ ...base, host: '100.64.0.7', isLoopback: false });
    const text = lines.join('\n');
    expect(text).toContain('Running at: http://100.64.0.7:4000');
    expect(text).toContain(base.tokenPath);
    expect(text).toContain('?token=<token>');
    expect(text).not.toMatch(/\?token=[0-9a-f]{8,}/);
  });
});
