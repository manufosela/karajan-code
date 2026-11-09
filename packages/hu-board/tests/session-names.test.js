// KJC-TSK-1483: a host robot carries the name the user gave its Claude Code session.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSessionNames, withSessionName } from '../src/session-names.js';

const ID = '6d9a17f7-9cbb-4cb0-9130-1ef508ec982d';
let home;
const transcript = (claudeDir, project, id) => {
  const dir = join(home, claudeDir, 'projects', project);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${id}.jsonl`);
};
const title = (name) => `${JSON.stringify({ type: 'custom-title', customTitle: name, sessionId: ID })}\n`;

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'hu-board-session-names-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('createSessionNames', () => {
  it('finds the session under any Claude home and reads its last title', () => {
    const file = transcript('.claude-tribbu', '-home-manu-proj', ID);
    writeFileSync(file, title('old name') + '{"type":"user"}\n' + title('kj-stage'));
    expect(createSessionNames({ home }).nameOf(ID)).toBe('kj-stage');
  });

  it('is null for a session without a title, one not found, or an id that is not a session id', () => {
    writeFileSync(transcript('.claude', 'p', ID), '{"type":"user"}\n');
    const { nameOf } = createSessionNames({ home });
    expect(nameOf(ID)).toBeNull();
    expect(nameOf('1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBeNull();
    expect(nameOf('../../etc/passwd')).toBeNull();
  });

  it('keeps a name for a while, then reads a rename', () => {
    const file = transcript('.claude', 'p', ID);
    writeFileSync(file, title('first'));
    let t = 0;
    const { nameOf } = createSessionNames({ home, now: () => t, ttlMs: 1000 });
    expect(nameOf(ID)).toBe('first');
    appendFileSync(file, title('second'));
    expect(nameOf(ID)).toBe('first');
    t = 1000;
    expect(nameOf(ID)).toBe('second');
  });
});

describe('withSessionName', () => {
  const nameOf = (id) => (id === ID ? 'kj-stage' : null);

  it('names a host by its session; leaves anyone else untouched', () => {
    expect(withSessionName({ role: 'host', id: ID, agent: 'claude' }, nameOf)).toMatchObject({ name: 'kj-stage' });
    const coder = { role: 'coder', agent: 'codex' };
    expect(withSessionName(coder, nameOf)).toBe(coder);
  });
});
