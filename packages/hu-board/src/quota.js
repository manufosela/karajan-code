// Each agent's quota as its provider reports it, window by window. Nothing is invented.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = { 300: '5h', 10080: 'week', 43200: 'month' };
const CLAUDE_WINDOWS = { five_hour: '5h', seven_day: 'week' };

export const windowOf = (minutes) => NAMES[minutes] ?? `${minutes}m`;

export function codexReadings(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }
  const limits = event?.payload?.rate_limits ?? event?.rate_limits;
  if (!limits) return [];
  return [limits.primary, limits.secondary]
    .filter(Boolean)
    .map((w) => ({ agent: 'codex', window: windowOf(w.window_minutes), usedPercent: w.used_percent, resetsAt: w.resets_at }));
}

export function claudeReadings(info) {
  return Object.entries(info?.unifiedWindows ?? {}).map(([key, w]) => ({
    agent: 'claude',
    window: CLAUDE_WINDOWS[key] ?? key,
    usedPercent: Math.round(w.utilization * 100),
    resetsAt: w.resetsAt,
  }));
}

function jsonlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsonlFiles(path);
    return entry.name.endsWith('.jsonl') ? [path] : [];
  });
}

export function latestCodexReadings(root) {
  let files;
  try {
    files = jsonlFiles(root).map((path) => ({ path, mtime: statSync(path).mtimeMs }));
  } catch {
    return [];
  }
  if (files.length === 0) return [];
  const newest = files.reduce((a, b) => (b.mtime > a.mtime ? b : a));
  const lines = readFileSync(newest.path, 'utf8').split('\n');
  for (const line of lines.reverse()) {
    const readings = codexReadings(line);
    if (readings.length > 0) return readings;
  }
  return [];
}
