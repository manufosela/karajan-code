/**
 * Detects rate limit / usage cap messages from CLI agent output.
 * Returns { isRateLimit, agent, message, cooldownUntil, cooldownMs }
 * where agent is the best guess of which CLI triggered it (or "unknown").
 */

/**
 * Extracts cooldown timing from a rate limit message string.
 * Returns { cooldownUntil, cooldownMs } where cooldownUntil is an ISO string
 * and cooldownMs is milliseconds to wait, or both null if not found.
 */
export function parseCooldown(message) {
  if (!message || typeof message !== "string") {
    return { cooldownUntil: null, cooldownMs: null };
  }

  // 1. ISO timestamp: "try again after 2026-03-07T15:30:00Z"
  //    Also: "resets at 2026-03-07T15:30:00Z"
  const isoMatch = /(?:after|at)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/i.exec(
    message
  );
  if (isoMatch) {
    const target = new Date(isoMatch[1]);
    if (!Number.isNaN(target.getTime())) {
      const ms = Math.max(0, target.getTime() - Date.now());
      return { cooldownUntil: target.toISOString(), cooldownMs: ms };
    }
  }

  // 4. Claude specific: "resets at 2026-03-07 15:30 UTC" (space-separated date/time)
  const resetMatch = /resets?\s+at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*UTC/i.exec(
    message
  );
  if (resetMatch) {
    const target = new Date(`${resetMatch[1]}T${resetMatch[2]}:00Z`);
    if (!Number.isNaN(target.getTime())) {
      const ms = Math.max(0, target.getTime() - Date.now());
      return { cooldownUntil: target.toISOString(), cooldownMs: ms };
    }
  }

  // 5. Claude Code session / weekly limit: "resets 10:10pm (Europe/Madrid)" / "resets 4am"
  //    KJC-BUG-0064: prefer the parenthesised IANA TZ when present so the
  //    same stderr resolves to the same instant regardless of where kj runs
  //    (CI in TZ=UTC was misclassifying Madrid 10:10pm as already past).
  //    No TZ literal → fall back to the host's local TZ.
  const ampmMatch = /reset(?:s|ting)?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b/i.exec(message);
  if (ampmMatch) {
    let hour = Number.parseInt(ampmMatch[1], 10) % 12;
    if (/pm/i.test(ampmMatch[3])) hour += 12;
    const minute = ampmMatch[2] ? Number.parseInt(ampmMatch[2], 10) : 0;
    if (hour < 24 && minute < 60) {
      const tzMatch = /\(([A-Za-z]+\/[A-Za-z_/+\-0-9]+)\)/.exec(message);
      const tz = tzMatch ? tzMatch[1] : null;
      const target = tz ? nextOccurrenceInTZ(hour, minute, tz) : nextOccurrenceLocal(hour, minute);
      if (target) return { cooldownUntil: target.toISOString(), cooldownMs: Math.max(0, target.getTime() - Date.now()) };
    }
  }

  // 2. Relative seconds: "retry after 120 seconds" / "retry in 120s" / "Retry-After: 120"
  const secMatch = /(?:retry[\s-]*after|retry\s+in|wait)\s*:?\s*(\d+)\s*(?:seconds?|secs?|s\b)/i.exec(
    message
  ) || /Retry-After:\s*(\d+)/i.exec(message);
  if (secMatch) {
    const seconds = Number.parseInt(secMatch[1], 10);
    const ms = seconds * 1000;
    const target = new Date(Date.now() + ms);
    return { cooldownUntil: target.toISOString(), cooldownMs: ms };
  }

  // 3. Relative minutes: "retry in 5 minutes" / "wait 5 min"
  const minMatch = /(?:retry\s+in|wait|after)\s+(\d+)\s*(?:minutes?|mins?)/i.exec(
    message
  );
  if (minMatch) {
    const minutes = Number.parseInt(minMatch[1], 10);
    const ms = minutes * 60 * 1000;
    const target = new Date(Date.now() + ms);
    return { cooldownUntil: target.toISOString(), cooldownMs: ms };
  }

  return { cooldownUntil: null, cooldownMs: null };
}

// KJC-BUG-0064 — TZ-aware "next occurrence of hour:minute" resolver.
// Walks today + tomorrow in the given IANA TZ; returns the first instant
// > now. Uses Intl.DateTimeFormat as the source of truth so it works on
// any host TZ (CI runs UTC, dev runs Europe/Madrid, etc.).
function nextOccurrenceInTZ(hour, minute, tz) {
  try {
    const now = new Date();
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      const probe = new Date(now.getTime() + dayOffset * 86400000);
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(probe).reduce((acc, p) => (p.type !== "literal" ? { ...acc, [p.type]: p.value } : acc), {});
      if (!parts.year) return null;
      const candidate = zonedTimeToUTC(Number(parts.year), Number(parts.month), Number(parts.day), hour, minute, tz);
      if (candidate && candidate.getTime() > now.getTime()) return candidate;
    }
    return null;
  } catch { return null; }
}

// Converts a wall-clock date + time in `tz` to a UTC Date.
// Strategy: interpret year/month/day/hour/minute as naive UTC, see what
// wall-clock that maps to in `tz`, derive the offset (tz - UTC at that
// moment) and subtract it from the naive value to land on the true UTC.
// One step suffices except at DST transitions (within ±1h, acceptable
// for cooldown timing).
function zonedTimeToUTC(year, month, day, hour, minute, tz) {
  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(naiveUTC)).reduce((acc, p) => (p.type !== "literal" ? { ...acc, [p.type]: p.value } : acc), {});
  const wallInTZ = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  const tzOffset = wallInTZ - naiveUTC; // positive when tz is ahead of UTC
  return new Date(naiveUTC - tzOffset);
}

function nextOccurrenceLocal(hour, minute) {
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
  return target;
}

const RATE_LIMIT_PATTERNS = [
  // Claude CLI
  { pattern: /usage limit/i, agent: "claude" },
  { pattern: /plan's usage limit/i, agent: "claude" },
  { pattern: /Claude Pro usage limit/i, agent: "claude" },
  { pattern: /session limit/i, agent: "claude" },
  { pattern: /weekly limit/i, agent: "claude" },

  // OpenAI / Codex CLI
  { pattern: /exceeded your current quota/i, agent: "codex" },

  // Gemini CLI
  { pattern: /resource exhausted/i, agent: "gemini" },
  { pattern: /quota exceeded/i, agent: "gemini" },

  // Generic rate limits (match any agent)
  { pattern: /rate limit/i, agent: "unknown" },
  { pattern: /token limit reached/i, agent: "unknown" },
  { pattern: /\b429\b/, agent: "unknown" },
  { pattern: /too many requests/i, agent: "unknown" },
  { pattern: /throttl/i, agent: "unknown" },

  // Provider outages / transient errors (treat like rate limits → retry)
  { pattern: /\b500\b.*(?:internal server error|error)/i, agent: "unknown" },
  { pattern: /\b502\b|bad gateway/i, agent: "unknown" },
  { pattern: /\b503\b|service unavailable/i, agent: "unknown" },
  { pattern: /\b504\b|gateway timeout/i, agent: "unknown" },
  { pattern: /overloaded/i, agent: "unknown" },
  { pattern: /ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up/i, agent: "unknown" },
  { pattern: /network error|fetch failed/i, agent: "unknown" },
];

export function detectRateLimit({ stderr = "", stdout = "" }) {
  const combined = `${stderr}\n${stdout}`;

  const PROVIDER_OUTAGE_PATTERNS = /\b50[0-4]\b|bad gateway|service unavailable|gateway timeout|overloaded|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|network error|fetch failed/i;

  for (const { pattern, agent } of RATE_LIMIT_PATTERNS) {
    if (pattern.test(combined)) {
      const matchedLine = combined.split("\n").find((l) => pattern.test(l)) || combined.trim();
      const isProviderOutage = PROVIDER_OUTAGE_PATTERNS.test(matchedLine);
      return {
        isRateLimit: true,
        isProviderOutage,
        agent,
        message: matchedLine.trim(),
        ...parseCooldown(matchedLine)
      };
    }
  }

  return { isRateLimit: false, isProviderOutage: false, agent: "", message: "", cooldownUntil: null, cooldownMs: null };
}
