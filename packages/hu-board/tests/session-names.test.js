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

// KJC-TSK-1537: and the model it answers with, from the last answer of its transcript.
describe('modelOf', () => {
  const answer = (model) => `${JSON.stringify({ type: 'assistant', message: { model, content: [] } })}\n`;

  it('reads the model of the last answer, and is null without one', () => {
    const file = transcript('.claude', 'p', ID);
    // A later record that is not an answer, naming another model, does not count.
    const other = `${JSON.stringify({ type: 'system', model: 'claude-haiku-5-5' })}\n`;
    writeFileSync(file, answer('claude-sonnet-5-5') + '{"type":"user"}\n' + answer('claude-opus-5-5') + other);
    expect(createSessionNames({ home }).modelOf(ID)).toBe('claude-opus-5-5');
    // Claude Code's own notices are answers that name no Claude model: the session's model stays.
    writeFileSync(file, answer('claude-opus-5-5') + answer('<synthetic>') + `${JSON.stringify({ type: 'assistant', message: {} })}\n`);
    expect(createSessionNames({ home }).modelOf(ID)).toBe('claude-opus-5-5');
    writeFileSync(file, '{"type":"user"}\n');
    expect(createSessionNames({ home }).modelOf(ID)).toBeNull();
    expect(createSessionNames({ home }).modelOf('../../etc/passwd')).toBeNull();
  });
});

// KJC-TSK-1606: what the session's last stop line waits for.
describe('waitOf', () => {
  const said = (text) => `${JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text }] } })}\n`;

  it('reads the last stop line of the session\'s answers', () => {
    const file = transcript('.claude', 'p', ID);
    writeFileSync(file, said('Me paro porque no me queda trabajo.') + '{"type":"user"}\n' + said('Hecho.\n\nMe paro porque espero tu respuesta.'));
    expect(createSessionNames({ home }).waitOf(ID)).toBe('person');
    writeFileSync(file, said('Me paro porque espero a que termine la CI, que me avisará.'));
    expect(createSessionNames({ home }).waitOf(ID)).toBe('process');
  });

  it('is null when the last answer has no stop line or there is no transcript', () => {
    writeFileSync(transcript('.claude', 'p', ID), said('Me paro porque espero tu respuesta.') + said('Sigo con lo siguiente.'));
    expect(createSessionNames({ home }).waitOf(ID)).toBeNull();
    expect(createSessionNames({ home }).waitOf('../../etc/passwd')).toBeNull();
  });
});

describe('withSessionName', () => {
  const nameOf = (id) => (id === ID ? 'kj-stage' : null);

  // KJC-TSK-1606: a host's end says what it waits for, when its session says it.
  it('marks a host\'s end with what its session waits for; not a start, not anyone else', () => {
    const waitOf = (id) => (id === ID ? 'person' : null);
    expect(withSessionName({ role: 'host', id: ID, agent: 'claude', phase: 'end' }, nameOf, () => null, waitOf)).toMatchObject({ waits: 'person' });
    expect(withSessionName({ role: 'host', id: ID, agent: 'claude', phase: 'start' }, nameOf, () => null, waitOf)).not.toHaveProperty('waits');
    expect(withSessionName({ role: 'host', id: 'other', agent: 'claude', phase: 'end' }, nameOf, () => null, waitOf)).not.toHaveProperty('waits');
  });

  it('gives a host the model of its session when its transcript says it', () => {
    const modelOf = (id) => (id === ID ? 'claude-opus-5-5' : null);
    expect(withSessionName({ role: 'host', id: ID, agent: 'claude' }, nameOf, modelOf)).toMatchObject({ name: 'kj-stage', model: 'claude-opus-5-5' });
    expect(withSessionName({ role: 'host', id: ID, agent: 'claude' }, nameOf, () => null)).not.toHaveProperty('model');
  });

  it('names a host by its session; leaves anyone else untouched', () => {
    expect(withSessionName({ role: 'host', id: ID, agent: 'claude' }, nameOf)).toMatchObject({ name: 'kj-stage' });
    const coder = { role: 'coder', agent: 'codex' };
    expect(withSessionName(coder, nameOf)).toBe(coder);
  });
});
