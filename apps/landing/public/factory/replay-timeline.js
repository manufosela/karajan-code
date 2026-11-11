// KJL-TSK-0161 (ADR 0052): the replay timeline of the factory demo. Pure functions,
// no DOM and no Node APIs: the recorded waits are shortened so the scene plays fast.
export const MAX_WAIT_MS = 2500;

export function timeline(events, maxWait = MAX_WAIT_MS) {
  let ms = 0;
  return events.map((event, i) => {
    if (i > 0) {
      const gap = Date.parse(event.at) - Date.parse(events[i - 1].at);
      ms += Math.min(gap, maxWait);
    }
    return { ms, event };
  });
}

export function asNow(event, now) {
  return { ...event, at: new Date(now).toISOString() };
}

const isIso = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

export function shifted(state, ms) {
  if (Array.isArray(state)) return state.map((item) => shifted(item, ms));
  if (state === null || typeof state !== "object") return state;
  return Object.fromEntries(
    Object.entries(state).map(([key, value]) => [
      key,
      key === "at" && isIso(value) ? new Date(Date.parse(value) + ms).toISOString() : shifted(value, ms),
    ]),
  );
}
