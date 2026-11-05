import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activityEvent, denialEvent, decisionEvent, gateEvent, verdictEvent, createTail, watchStageFeed } from '../src/stage-feed.js';

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

  it('a commit attempt keeps when, its outcome and the rule (KJC-TSK-1427)', () => {
    expect(gateEvent(JSON.stringify({ at: 't4', outcome: 'refuse', rule: 'body' }))).toEqual({ type: 'commit-gate', at: 't4', outcome: 'refuse', rule: 'body' });
    expect(gateEvent(JSON.stringify({ at: 't4', outcome: 'maybe', rule: 'x' }))).toBeNull();
  });

  it('an agent at work keeps who, in which role, the phase and its outcome (KJC-TSK-1430)', () => {
    expect(activityEvent(JSON.stringify({ at: 't6', agent: 'codex', role: 'reviewer', phase: 'end', outcome: 'ok' })))
      .toEqual({ type: 'agent-activity', at: 't6', agent: 'codex', role: 'reviewer', phase: 'end', outcome: 'ok' });
    expect(activityEvent(JSON.stringify({ at: 't6', agent: 'codex', role: 'reviewer', phase: 'start' })))
      .toEqual({ type: 'agent-activity', at: 't6', agent: 'codex', role: 'reviewer', phase: 'start', outcome: null });
    expect(activityEvent(JSON.stringify({ at: 't6', agent: 'codex', phase: 'nap' }))).toBeNull();
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
    watcher.emit('change', join(dir, '.karajan', 'other.json'));
    expect(sent.map((e) => [e.type, e.project])).toEqual([
      ['sentinel-deny', 'demo'], ['ledger-seal', 'demo'], ['review-verdict', 'demo'], ['commit-gate', 'demo'], ['agent-activity', 'demo'],
    ]);
    stop();
    expect(watcher.closed).toBe(true);
  });
});
