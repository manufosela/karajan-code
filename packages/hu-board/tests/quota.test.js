// KJC-TSK-1821 (decided by the maintainer on 2026-11-28: "del proveedor, nada más, y enseñar el gasto
// de la semana y mes si no"): each agent's quota as its provider reports it, window by window, never
// a window the provider does not give. Codex writes `rate_limits` in its session logs; claude sends a
// `rate_limit_event` with `rate_limit_info` in its stream.
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { claudeReadings, codexReadings, latestCodexReadings, windowOf } from '../src/quota.js';

const codexLine = (primary, secondary = null) => JSON.stringify({ timestamp: '2026-11-28T12:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary, secondary, plan_type: 'prolite' } } });

describe('windowOf', () => {
  it('names the windows the providers use, and any other by its minutes', () => {
    expect(windowOf(300)).toBe('5h');
    expect(windowOf(10080)).toBe('week');
    expect(windowOf(43200)).toBe('month');
    expect(windowOf(90)).toBe('90m');
  });
});

describe('codexReadings', () => {
  it('reads each window codex reports, as a percentage, with when it resets', () => {
    expect(codexReadings(codexLine({ used_percent: 10, window_minutes: 10080, resets_at: 1795862194 }))).toEqual([
      { agent: 'codex', window: 'week', usedPercent: 10, resetsAt: 1795862194 },
    ]);
    expect(codexReadings(codexLine({ used_percent: 3, window_minutes: 300, resets_at: 1 }, { used_percent: 40, window_minutes: 10080, resets_at: 2 })).map((r) => r.window)).toEqual(['5h', 'week']);
  });

  it('invents nothing: a line without rate limits, or not JSON, gives none', () => {
    expect(codexReadings(JSON.stringify({ type: 'event_msg', payload: { type: 'token_count' } }))).toEqual([]);
    expect(codexReadings('not json')).toEqual([]);
    expect(codexReadings(codexLine(null))).toEqual([]);
  });
});

describe('claudeReadings', () => {
  it('reads each window claude reports, its utilization as a percentage', () => {
    const info = { status: 'allowed', resetsAt: 1795867800, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.01, resetsAt: 1795867800, status: 'allowed' }, seven_day: { utilization: 0.42, resetsAt: 1796083200, status: 'allowed' } } };
    expect(claudeReadings(info)).toEqual([
      { agent: 'claude', window: '5h', usedPercent: 1, resetsAt: 1795867800 },
      { agent: 'claude', window: 'week', usedPercent: 42, resetsAt: 1796083200 },
    ]);
  });

  it('invents nothing without windows', () => {
    expect(claudeReadings({ status: 'allowed' })).toEqual([]);
    expect(claudeReadings(null)).toEqual([]);
  });
});

describe('latestCodexReadings', () => {
  it('takes the last rate limits of the newest codex session, under the day folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
    mkdirSync(join(root, '2026', '11', '28'), { recursive: true });
    const old = join(root, '2026', '11', '28', 'rollout-a.jsonl');
    const fresh = join(root, '2026', '11', '28', 'rollout-b.jsonl');
    writeFileSync(old, `${codexLine({ used_percent: 99, window_minutes: 10080, resets_at: 1 })}\n`);
    writeFileSync(fresh, `${codexLine({ used_percent: 5, window_minutes: 10080, resets_at: 1 })}\n${codexLine({ used_percent: 7, window_minutes: 10080, resets_at: 2 })}\n{"type":"other"}\n`);
    utimesSync(old, new Date('2026-11-27'), new Date('2026-11-27'));
    expect(latestCodexReadings(root)).toEqual([{ agent: 'codex', window: 'week', usedPercent: 7, resetsAt: 2 }]);
    expect(latestCodexReadings(join(root, 'missing'))).toEqual([]);
  });
});
