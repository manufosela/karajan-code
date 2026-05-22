import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyAgentError, ERROR_CLASS } from "../../src/brain/agent-error-classifier.js";

// KJC-TSK-0411: clasificación rica de errores de agente para que Brain
// (TSK-0412) tenga metadata accionable. Tests con fixtures de stderr
// reales de cada provider — sin reales LLM en el loop.

describe("classifyAgentError — AUTH_FAILED", () => {
  it("detecta 401 Unauthorized", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "Error 401: Unauthorized — invalid api key", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.AUTH_FAILED);
    expect(r.recoverable).toBe(false);
  });
  it("detecta 403 forbidden", () => {
    const r = classifyAgentError({ provider: "codex", stderr: "HTTP 403 Forbidden — authentication failed", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.AUTH_FAILED);
  });
  it("detecta token expirado", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "expired token, please re-authenticate", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.AUTH_FAILED);
  });
});

describe("classifyAgentError — SILENCED", () => {
  it("detecta killed after Nms", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "Command killed after 180000ms without output", exitCode: 143 });
    expect(r.class).toBe(ERROR_CLASS.SILENCED);
    expect(r.recoverable).toBe(true);
  });
  it("detecta exit 143 con stderr vacío como SILENCED defensive", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "", exitCode: 143 });
    expect(r.class).toBe(ERROR_CLASS.SILENCED);
  });
  it("detecta 'silence timeout'", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "agent hit silence timeout after 90 seconds", exitCode: 143 });
    expect(r.class).toBe(ERROR_CLASS.SILENCED);
  });
});

describe("classifyAgentError — RATE_LIMIT_SHORT vs QUOTA_EXHAUSTED_DAILY", () => {
  it("rate limit con retry-after 30s → SHORT con retryAfter ms", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "rate limit hit, retry after 30 seconds", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.RATE_LIMIT_SHORT);
    expect(r.retryAfter).toBe(30000);
    expect(r.recoverable).toBe(true);
  });
  it("rate limit sin cooldown explícito → SHORT con retryAfter null", () => {
    const r = classifyAgentError({ provider: "codex", stderr: "429 Too Many Requests", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.RATE_LIMIT_SHORT);
    expect(r.retryAfter).toBeNull();
  });
  it("usage limit con reset >1h → QUOTA_EXHAUSTED_DAILY", () => {
    // 5h en el futuro = 18000000ms > 1h
    const target = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const r = classifyAgentError({ provider: "claude", stderr: `Claude Pro usage limit, resets at ${target}`, exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.QUOTA_EXHAUSTED_DAILY);
    expect(r.retryUntil).toBe(target);
    expect(r.retryAfter).toBeGreaterThan(60 * 60 * 1000);
    expect(r.recoverable).toBe(true);
  });
  it("Gemini resource exhausted → SHORT (sin cooldown explícito)", () => {
    const r = classifyAgentError({ provider: "gemini", stderr: "resource exhausted", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.RATE_LIMIT_SHORT);
  });

  // KJC-TSK-0415: nueva clase MONTHLY (Anthropic Agent SDK $200/mes desde jun-2026).
  it("usage limit con reset > 7 días → QUOTA_EXHAUSTED_MONTHLY", () => {
    const target = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const r = classifyAgentError({ provider: "claude", stderr: `Agent SDK monthly limit, resets at ${target}`, exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.QUOTA_EXHAUSTED_MONTHLY);
    expect(r.retryUntil).toBe(target);
  });

  it("threshold: 6 días → DAILY, 8 días → MONTHLY", () => {
    const sixDays = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
    const eightDays = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(classifyAgentError({ stderr: `usage limit, resets at ${sixDays}`, exitCode: 1 }).class).toBe(ERROR_CLASS.QUOTA_EXHAUSTED_DAILY);
    expect(classifyAgentError({ stderr: `usage limit, resets at ${eightDays}`, exitCode: 1 }).class).toBe(ERROR_CLASS.QUOTA_EXHAUSTED_MONTHLY);
  });
});

describe("classifyAgentError — API_DOWN", () => {
  it("HTTP 503 service unavailable", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "503 service unavailable", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.API_DOWN);
    expect(r.recoverable).toBe(true);
  });
  it("Anthropic overloaded", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "Anthropic API overloaded, please retry", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.API_DOWN);
  });
  it("HTTP 502 bad gateway", () => {
    const r = classifyAgentError({ provider: "codex", stderr: "502 bad gateway from proxy", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.API_DOWN);
  });
});

describe("classifyAgentError — NETWORK_TIMEOUT", () => {
  it("ECONNRESET", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "fetch failed: ECONNRESET", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.NETWORK_TIMEOUT);
    expect(r.recoverable).toBe(true);
  });
  it("ETIMEDOUT", () => {
    const r = classifyAgentError({ provider: "gemini", stderr: "Error: ETIMEDOUT connecting to api.example.com", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.NETWORK_TIMEOUT);
  });
  it("socket hang up", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "socket hang up during streaming", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.NETWORK_TIMEOUT);
  });
});

describe("classifyAgentError — precedencia", () => {
  it("AUTH_FAILED gana sobre RATE_LIMIT (401 + 429 en el mismo output)", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "401 unauthorized — rate limit applies", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.AUTH_FAILED);
  });
  it("NETWORK_TIMEOUT gana sobre API_DOWN (ECONNREFUSED + 503)", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "503 ECONNREFUSED", exitCode: 1 });
    expect(r.class).toBe(ERROR_CLASS.NETWORK_TIMEOUT);
  });
});

describe("classifyAgentError — UNKNOWN_FATAL", () => {
  it("stderr no clasificable + exit != 0 → UNKNOWN_FATAL no recuperable", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "weird internal panic xyz", exitCode: 2 });
    expect(r.class).toBe(ERROR_CLASS.UNKNOWN_FATAL);
    expect(r.recoverable).toBe(false);
  });
  it("incluye exitCode en message si stderr está vacío", () => {
    const r = classifyAgentError({ provider: "claude", stderr: "", exitCode: 127 });
    expect(r.class).toBe(ERROR_CLASS.UNKNOWN_FATAL);
    expect(r.message).toMatch(/127/);
  });
});

describe("classifyAgentError — provider passthrough", () => {
  it("preserva el provider en la salida", () => {
    const r = classifyAgentError({ provider: "opencode", stderr: "429 rate limit", exitCode: 1 });
    expect(r.provider).toBe("opencode");
  });
});

// Regression for the 2026-05-22 dogfooding: Claude Code's
// "You've hit your session limit · resets <time>" reached UNKNOWN_FATAL
// (abort) because the rate-limit regex lacked "session limit". It must
// classify as a recoverable quota class so Brain hibernates.
describe("classifyAgentError — Claude Code session limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T17:24:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("'hit your session limit · resets 10:10pm' → QUOTA_EXHAUSTED_DAILY, recoverable", () => {
    const r = classifyAgentError({
      provider: "claude",
      stderr: "You've hit your session limit · resets 10:10pm (Europe/Madrid)",
      exitCode: 1,
    });
    expect(r.class).toBe(ERROR_CLASS.QUOTA_EXHAUSTED_DAILY);
    expect(r.recoverable).toBe(true);
    // > 1h until the 22:10 reset → Brain hibernates instead of aborting.
    expect(r.retryAfter).toBeGreaterThan(60 * 60 * 1000);
    expect(r.retryUntil).toBeTruthy();
  });

  it("is no longer misclassified as UNKNOWN_FATAL", () => {
    const r = classifyAgentError({
      provider: "claude",
      stderr: "You've hit your session limit · resets 10:10pm (Europe/Madrid)",
      exitCode: 1,
    });
    expect(r.class).not.toBe(ERROR_CLASS.UNKNOWN_FATAL);
  });
});
