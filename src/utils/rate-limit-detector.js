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

const RATE_LIMIT_PATTERNS = [
  // Claude CLI
  { pattern: /usage limit/i, agent: "claude" },
  { pattern: /plan's usage limit/i, agent: "claude" },
  { pattern: /Claude Pro usage limit/i, agent: "claude" },

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
