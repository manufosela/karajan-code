import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activityEvent, cardEvent, denialEvent, decisionEvent, gateEvent, methodEvent, ragEvent, ragIndexEvent, verdictEvent, createTail, watchStageFeed } from '../src/stage-feed.js';

const line = (o) => `${JSON.stringify(o)}\n`;

describe('stage events from kj records', () => {
  it('a Sentinel denial keeps when, tool and the first line of why, never the input', () => {
    const ev = denialEvent(JSON.stringify({ at: 't1', sid: 's', tool: 'Bash', input: 'echo SECRET', why: 'blocked\nmore' }));
    expect(ev).toEqual({ type: 'sentinel-deny', at: 't1', tool: 'Bash', why: 'blocked' });
  });

  it('a sealed decision keeps its decision and chokepoint', () => {
    const ev = decisionEvent(JSON.stringify({ ts: 't2', decision: 'deny', chokepoint: 'commit', prev: 'x' }));
    expect(ev).toEqual({ type: 'ledger-seal', at: 't2', decision: 'deny', chokepoint: 'commit' });
  });

  it('a verdict keeps who reviewed, for which host and diff', () => {
    const raw = JSON.stringify({ verdict: 'rejected', reviewer: 'agy', host: 'claude', diffHash: 'abc', timestamp: 't3', issues: ['x'] });
    expect(verdictEvent(raw)).toEqual({ type: 'review-verdict', at: 't3', verdict: 'rejected', reviewer: 'agy', host: 'claude', diffHash: 'abc' });
  });

  // HU-4104: a rag-first refusal asks for a RAG query, it does not judge the code.
  it('a rag-first rejection is no verdict, but a codex rejection still is', () => {
    const rejected = (reviewer) => JSON.stringify({ verdict: 'rejected', reviewer, diffHash: 'abc', timestamp: 't3' });
    expect(verdictEvent(rejected('rag-first'))).toBeNull();
    expect(verdictEvent(rejected('codex'))).toMatchObject({ type: 'review-verdict', verdict: 'rejected', reviewer: 'codex' });
  });

  it('a commit attempt keeps when, its outcome and the rule (KJC-TSK-1427)', () => {
    expect(gateEvent(JSON.stringify({ at: 't4', outcome: 'refuse', rule: 'body' }))).toEqual({ type: 'commit-gate', at: 't4', outcome: 'refuse', rule: 'body' });
    expect(gateEvent(JSON.stringify({ at: 't4', outcome: 'maybe', rule: 'x' }))).toBeNull();
  });

  it('an agent at work keeps who, in which role, the phase and its outcome (KJC-TSK-1430)', () => {
    expect(activityEvent(JSON.stringify({ at: 't6', agent: 'codex', role: 'reviewer', phase: 'end', outcome: 'ok' })))
      .toEqual({ type: 'agent-activity', at: 't6', agent: 'codex', role: 'reviewer', phase: 'end', outcome: 'ok', skills: [], id: null, tool: null, kind: null });
    expect(activityEvent(JSON.stringify({ at: 't6', agent: 'codex', role: 'reviewer', phase: 'start' })))
      .toEqual({ type: 'agent-activity', at: 't6', agent: 'codex', role: 'reviewer', phase: 'start', outcome: null, skills: [], id: null, tool: null, kind: null });
    // KJC-TSK-1434: the host's trace keeps its id and the kind of tool; a subagent, its type; nothing but names.
    expect(activityEvent(JSON.stringify({ at: 't6', agent: 'claude', role: 'host', phase: 'start', id: 's1', tool: 'Bash' })))
      .toMatchObject({ role: 'host', id: 's1', tool: 'Bash', kind: null });
    expect(activityEvent(JSON.stringify({ at: 't6', agent: 'claude', role: 'subagent', phase: 'start', id: 'a7', kind: { x: 1 } })).kind).toBeNull();
    // KJC-TSK-1428: the atril skills on a start line, names only.
    expect(activityEvent(JSON.stringify({ at: 't6', agent: 'codex', role: 'reviewer', phase: 'start', skills: ['tdd', 7] })).skills).toEqual(['tdd']);
    expect(activityEvent(JSON.stringify({ at: 't6', agent: 'codex', phase: 'nap' }))).toBeNull();
    // KJC-TSK-1536: the model and effort a start line names, only when they are text.
    expect(activityEvent(JSON.stringify({ at: 't7', agent: 'claude', role: 'coder', phase: 'start', model: 'claude-opus-5-5', effort: 'high' }))).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' });
    expect(activityEvent(JSON.stringify({ at: 't7', agent: 'claude', role: 'coder', phase: 'start', model: 7 }))).not.toHaveProperty('model');
  });

  it("the RAG's answer note gives its count, and none when its time or sources are not real (KJC-TSK-1438)", () => {
    expect(ragEvent(JSON.stringify({ at: 0, sources: [] }))).toEqual({ type: 'rag-answer', at: '1970-01-01T00:00:00.000Z', sources: 0 });
    expect(ragEvent(JSON.stringify({ at: 1e20, sources: [] }))).toBeNull();
    expect(ragEvent(JSON.stringify({ at: '2026', sources: [] }))).toBeNull();
    expect(ragEvent(JSON.stringify({ at: 5, sources: 'a' }))).toBeNull();
  });

  it("the RAG's index note gives whether a reindex starts or ends, and none for another phase (KJC-TSK-1521)", () => {
    expect(ragIndexEvent(JSON.stringify({ at: 0, phase: 'start' }))).toEqual({ type: 'rag-index', at: '1970-01-01T00:00:00.000Z', phase: 'start' });
    expect(ragIndexEvent(JSON.stringify({ at: 0, phase: 'end' })).phase).toBe('end');
    expect(ragIndexEvent(JSON.stringify({ at: 0, phase: 'nap' }))).toBeNull();
    expect(ragIndexEvent(JSON.stringify({ at: 1e20, phase: 'start' }))).toBeNull();
  });

  // KJC-TSK-1457 (ADR 0050): the card trace kj hu add and kj hu move leave in the lane.
  it('a card line gives the card, its short title and where it went; a queued move says so', () => {
    expect(cardEvent(JSON.stringify({ at: 't8', action: 'add', id: 'HU-1', title: 'Login', status: 'pending' })))
      .toEqual({ type: 'card', at: 't8', action: 'add', id: 'HU-1', title: 'Login', status: 'pending', queued: false });
    expect(cardEvent(JSON.stringify({ at: 't9', action: 'move', id: 'HU-1', status: 'running', queued: true })))
      .toEqual({ type: 'card', at: 't9', action: 'move', id: 'HU-1', title: null, status: 'running', queued: true });
    expect(cardEvent(JSON.stringify({ at: 't9', action: 'add', id: 'HU-1', title: 'x'.repeat(200), status: 'pending' })).title).toHaveLength(80);
    expect(cardEvent(JSON.stringify({ at: 't9', action: 'delete', id: 'HU-1', status: 'done' }))).toBeNull();
    expect(cardEvent(JSON.stringify({ at: 't9', action: 'move', id: 'HU-1', status: 'lost' }))).toBeNull();
    // KJC-BUG-0546: a line kj hu wrote from a lane into the main checkout names the lane.
    expect(cardEvent(JSON.stringify({ at: 't9', action: 'move', id: 'HU-1', status: 'done', lane: 'feat-x' })).lane).toBe('feat-x');
    expect(cardEvent(JSON.stringify({ at: 't9', action: 'move', id: 'HU-1', status: 'done', lane: 7 }))).not.toHaveProperty('lane');
  });

  it('a method line gives the piece kj review checked and whether it passed (KJC-TSK-1523)', () => {
    expect(methodEvent(JSON.stringify({ at: 't1', piece: 'sonar', outcome: 'refuse' }))).toEqual({ type: 'method-check', at: 't1', piece: 'sonar', outcome: 'refuse' });
    expect(methodEvent(JSON.stringify({ at: 't1', piece: 'oracle', outcome: 'pass' }))).toBeNull();
    expect(methodEvent(JSON.stringify({ at: 't1', piece: 'tdd', outcome: 'maybe' }))).toBeNull();
  });

  it('a malformed or shapeless record gives no event', () => {
    expect(denialEvent('{oops')).toBeNull();
    expect(decisionEvent(JSON.stringify({ ts: 't' }))).toBeNull();
    expect(verdictEvent(JSON.stringify({ reviewer: 'agy' }))).toBeNull();
  });
});

describe('createTail', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'stage-tail-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('skips the history present at start and returns only complete new lines', () => {
    const file = join(dir, 'log.jsonl');
    writeFileSync(file, line({ old: 1 }));
    const tail = createTail(file);
    appendFileSync(file, `${line({ n: 1 })}{"half":`);
    expect(tail.read()).toEqual([JSON.stringify({ n: 1 })]);
    appendFileSync(file, '2}\n');
    expect(tail.read()).toEqual(['{"half":2}']);
    expect(tail.read()).toEqual([]);
  });

  it('reads a file born after start from its first line, and restarts when it shrinks', () => {
    const file = join(dir, 'late.jsonl');
    const tail = createTail(file);
    writeFileSync(file, line({ a: 100 }));
    expect(tail.read()).toEqual([JSON.stringify({ a: 100 })]);
    writeFileSync(file, line({ b: 2 }));
    expect(tail.read()).toEqual([JSON.stringify({ b: 2 })]);
  });
});

describe('watchStageFeed', () => {
  let dir;
  let watcher;
  let sent;
  const watch = (paths, opts) => { watcher = Object.assign(new EventEmitter(), { paths, opts, closed: false, close() { this.closed = true; } }); return watcher; };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stage-feed-'));
    mkdirSync(join(dir, '.karajan', 'harness'), { recursive: true });
    mkdirSync(join(dir, '.karajan', 'reviews'), { recursive: true });
    sent = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('sends each new denial, seal and verdict tagged with the project, and skips bad lines', () => {
    const stop = watchStageFeed(dir, (ev) => sent.push(ev), { project: 'demo', watch, warn: () => {} });
    const denials = join(dir, '.karajan', 'harness', 'denials.jsonl');
    const decisions = join(dir, '.karajan', 'policy-decisions.jsonl');
    const verdict = join(dir, '.karajan', 'reviews', 'abc.json');
    appendFileSync(denials, `not json\n${line({ at: 't1', tool: 'Bash', why: 'no' })}`);
    watcher.emit('add', denials);
    appendFileSync(decisions, line({ ts: 't2', decision: 'allow', chokepoint: 'commit' }));
    watcher.emit('change', decisions);
    writeFileSync(verdict, JSON.stringify({ verdict: 'approved', reviewer: 'agy', host: 'claude', diffHash: 'abc', timestamp: 't3' }));
    watcher.emit('add', verdict);
    const gate = join(dir, '.karajan', 'harness', 'commit-gate.jsonl');
    appendFileSync(gate, line({ at: 't5', outcome: 'pass', rule: 'ok' }));
    watcher.emit('add', gate);
    const activity = join(dir, '.karajan', 'harness', 'agent-activity.jsonl');
    appendFileSync(activity, line({ at: 't7', agent: 'claude', role: 'coder', phase: 'start' }));
    watcher.emit('add', activity);
    const cards = join(dir, '.karajan', 'harness', 'cards.jsonl');
    appendFileSync(cards, line({ at: 't8', action: 'add', id: 'HU-1', title: 'Login', status: 'pending' }));
    watcher.emit('add', cards);
    // KJC-TSK-1438: the RAG's answer note, once per answer, with its count and never its question.
    const note = join(dir, '.karajan', 'harness', 'rag-answer.json');
    writeFileSync(note, JSON.stringify({ at: 1000, text: 'SECRET question', sources: ['a', 'b'] }));
    watcher.emit('add', note);
    watcher.emit('change', note);
    watcher.emit('change', join(dir, '.karajan', 'other.json'));
    expect(sent.at(-1)).toEqual({ type: 'rag-answer', at: '1970-01-01T00:00:01.000Z', sources: 2, project: 'demo' });
    // KJC-TSK-1521: the index note, once per phase: a start, then its end in the same millisecond.
    const index = join(dir, '.karajan', 'harness', 'rag-index.json');
    writeFileSync(index, JSON.stringify({ at: 2000, phase: 'start' }));
    watcher.emit('add', index);
    watcher.emit('change', index);
    writeFileSync(index, JSON.stringify({ at: 2000, phase: 'end' }));
    watcher.emit('change', index);
    expect(sent.map((e) => [e.type, e.project])).toEqual([
      ['sentinel-deny', 'demo'], ['ledger-seal', 'demo'], ['review-verdict', 'demo'], ['commit-gate', 'demo'], ['agent-activity', 'demo'],
      ['card', 'demo'], ['rag-answer', 'demo'], ['rag-index', 'demo'], ['rag-index', 'demo'],
    ]);
    expect(sent.at(-1)).toEqual({ type: 'rag-index', at: '1970-01-01T00:00:02.000Z', phase: 'end', project: 'demo' });
    expect(JSON.stringify(sent)).not.toContain('SECRET');
    stop();
    expect(watcher.closed).toBe(true);
  });

  it('sends a commit gate line appended to .karajan/traces and lets the way down to it through', () => {
    watchStageFeed(dir, (ev) => sent.push(ev), { project: 'demo', watch, warn: () => {} });
    const traces = join(dir, '.karajan', 'traces');
    mkdirSync(traces, { recursive: true });
    const gate = join(traces, 'commit-gate.jsonl');
    appendFileSync(gate, line({ at: 't9', outcome: 'refuse', rule: 'header' }));
    watcher.emit('add', gate);
    expect(sent).toEqual([{ type: 'commit-gate', at: 't9', outcome: 'refuse', rule: 'header', project: 'demo' }]);
    expect([traces, gate].map((p) => watcher.opts.ignored(p))).toEqual([false, false]);
  });
});
