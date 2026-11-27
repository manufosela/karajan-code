// KJC-TSK-1718 (the maintainer, 2026-11-22): a strip over the projects panel counts, across every
// factory, the kaRAGans indexing or answering and the Karajans at work, coding, reviewing or
// waiting for the person.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NBSP, censusLines, censusOf } from '../public/stage/census.js';
import { ragNow } from '../src/stage-state.js';
import { stageSummary } from '../src/stage-map.js';

const now = Date.parse('2026-11-22T10:00:00Z');
const ago = (min) => now - min * 60 * 1000;

describe('kaRAGan in a lane', () => {
  let tmp;
  const put = (name, body) => writeFileSync(join(tmp, 'harness', name), JSON.stringify(body));
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'hu-board-census-')); mkdirSync(join(tmp, 'harness')); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('is idle with nothing written', () => {
    expect(ragNow(tmp, now)).toEqual({ indexing: false, answering: false });
  });

  it('indexes from a start until its end, and not past half an hour', () => {
    put('rag-index.json', { at: ago(10), phase: 'start' });
    expect(ragNow(tmp, now).indexing).toBe(true);
    put('rag-index.json', { at: ago(5), phase: 'end' });
    expect(ragNow(tmp, now).indexing).toBe(false);
    put('rag-index.json', { at: ago(31), phase: 'start' });
    expect(ragNow(tmp, now).indexing).toBe(false);
  });

  it('answers a query until it gives its answer, and not past two minutes', () => {
    put('rag-query.json', { at: ago(1), phase: 'start' });
    expect(ragNow(tmp, now).answering).toBe(true);
    put('rag-answer.json', { at: ago(0.5), sources: [] });
    expect(ragNow(tmp, now).answering).toBe(false);
    put('rag-answer.json', { at: ago(1), sources: [] }); // in the query's very millisecond
    expect(ragNow(tmp, now).answering).toBe(false);
    put('rag-query.json', { at: ago(3), phase: 'start' });
    rmSync(join(tmp, 'harness', 'rag-answer.json'));
    expect(ragNow(tmp, now).answering).toBe(false);
  });
});

describe('the summary', () => {
  it('names each agent\'s role and the lane\'s kaRAGan', () => {
    const lanesOf = () => [{ lane: 'main', working: [{ role: 'coder', agent: 'claude' }, { role: 'host', waiting: 'person' }], cards: [], mail: 0, rag: { indexing: true, answering: false } }];
    const [factory] = stageSummary({ projects: [{ id: 'p' }], dirOf: () => '/x/p', lanesOf });
    expect(factory.lanes[0]).toMatchObject({ working: [{ role: 'coder' }, { role: 'host', waiting: 'person' }], rag: { indexing: true, answering: false } });
  });
});

describe('the census', () => {
  const IDLE = { indexing: false, answering: false };
  const lane = (working, rag = IDLE) => ({ working, rag });
  const factories = [
    { lanes: [lane([{ role: 'host' }, { role: 'coder' }, { role: 'subagent' }], { indexing: true, answering: false }), lane([{ role: 'reviewer' }])] },
    { lanes: [lane([{ role: 'host', waiting: 'person' }, { role: 'host', waiting: 'process' }], { indexing: true, answering: true })] },
    { lanes: [lane([])] },
  ];

  it('counts every factory', () => {
    expect(censusOf(factories)).toEqual({ indexing: 2, answering: 1, working: 3, coding: 1, reviewing: 1, waiting: 1, resting: 0, done: 0 });
  });

  it('says it without zeros, and says when all is quiet', () => {
    // A no-break space keeps each count with its word when the strip wraps.
    const lines = censusLines(censusOf(factories));
    expect(lines.rag).toBe(['2', 'indexing · 1', 'answering'].join(NBSP));
    expect(lines.karajan.replaceAll(NBSP, ' ')).toBe('3 at work · 1 coding · 1 reviewing · 1 waits for you');
    expect(censusLines(censusOf([factories[2]]))).toEqual({ rag: 'quiet', karajan: 'quiet' });
  });

  it('a summary from an older board, without roles or kaRAGan, still counts', () => {
    expect(censusOf([{ lanes: [{ working: [{}] }] }])).toMatchObject({ working: 1, indexing: 0 });
  });
});
