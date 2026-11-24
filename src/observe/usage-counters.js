// HU-4853 (KJC-TSK-1767): pure aggregator turning kj's usage record into per day/project/account/provider/role counters.
const KEYS = ["day", "project", "account", "provider", "role"];
const SUMS = ["durationMs", "tokensIn", "tokensOut", "cachedTokens", "costUsd"];
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}/;

// A total stays null while no call of the group reported the figure.
const add = (total, value) => (typeof value === "number" ? (total ?? 0) + value : total);

function utcDay(ts) {
  const time = typeof ts === "string" && ISO_TS.test(ts) ? Date.parse(ts) : Number.NaN;
  if (Number.isNaN(time)) throw new Error(`usage record without a valid ISO timestamp: ${JSON.stringify(ts)}`);
  return new Date(time).toISOString().slice(0, 10);
}

const emptyRow = (key) => ({ ...key, calls: 0, failures: 0, ...Object.fromEntries(SUMS.map((s) => [s, null])) });

/** One row per (day, project, account, provider, role), sorted by those keys. */
export function usageCounters(calls) {
  const groups = new Map();
  for (const c of calls) {
    const key = { day: utcDay(c.ts), project: c.project, account: c.account, provider: c.provider, role: c.role };
    const id = KEYS.map((k) => String(key[k])).join("\0");
    const row = groups.get(id) ?? emptyRow(key);
    row.calls += 1;
    if (typeof c.exitCode === "number" && c.exitCode !== 0) row.failures += 1;
    for (const s of SUMS) row[s] = add(row[s], c[s]);
    groups.set(id, row);
  }
  return [...groups.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}
