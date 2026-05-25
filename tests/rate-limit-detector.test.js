import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { detectRateLimit, parseCooldown } from "../src/utils/rate-limit-detector.js";

describe("detectRateLimit", () => {
  describe("Claude CLI rate limit patterns", () => {
    it("detects Claude usage limit message", () => {
      const result = detectRateLimit({
        stderr: "You've exceeded your usage limit. Please wait until 3:00 PM to continue.",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.agent).toBe("claude");
    });

    it("detects Claude token cap message", () => {
      const result = detectRateLimit({
        stderr: "",
        stdout: "Rate limit reached. Try again in 2 hours."
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("detects Claude plan limit message", () => {
      const result = detectRateLimit({
        stderr: "You have reached your plan's usage limit for this period.",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("detects Claude Pro limit message", () => {
      const result = detectRateLimit({
        stderr: "Claude Pro usage limit exceeded. Resets at 2026-03-01T15:00:00Z.",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
    });
  });

  describe("Codex CLI rate limit patterns", () => {
    it("detects Codex rate limit message", () => {
      const result = detectRateLimit({
        stderr: "Rate limit exceeded. Please try again later.",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("detects OpenAI quota exceeded", () => {
      const result = detectRateLimit({
        stderr: "Error: You exceeded your current quota, please check your plan and billing details.",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
    });
  });

  describe("Gemini CLI rate limit patterns", () => {
    it("detects Gemini rate limit from stderr", () => {
      const result = detectRateLimit({
        stderr: "Resource exhausted: quota exceeded for the model.",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("detects Gemini 429 error", () => {
      const result = detectRateLimit({
        stderr: "Error 429: Too many requests. Please retry after a moment.",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
    });
  });

  describe("Aider rate limit patterns", () => {
    it("detects Aider rate limit message", () => {
      const result = detectRateLimit({
        stderr: "Rate limit error from provider. Waiting to retry...",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("detects Aider token limit message", () => {
      const result = detectRateLimit({
        stderr: "",
        stdout: "Token limit reached for the current session."
      });
      expect(result.isRateLimit).toBe(true);
    });
  });

  describe("generic rate limit patterns", () => {
    it("detects HTTP 429 status code mention", () => {
      const result = detectRateLimit({
        stderr: "HTTP error: 429 Too Many Requests",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("detects throttled/throttling messages", () => {
      const result = detectRateLimit({
        stderr: "Request throttled. Please wait before retrying.",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
    });
  });

  describe("non-rate-limit errors", () => {
    it("returns false for regular errors", () => {
      const result = detectRateLimit({
        stderr: "Error: file not found",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(false);
    });

    it("returns false for syntax errors", () => {
      const result = detectRateLimit({
        stderr: "SyntaxError: Unexpected token",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(false);
    });

    it("returns false for empty output", () => {
      const result = detectRateLimit({ stderr: "", stdout: "" });
      expect(result.isRateLimit).toBe(false);
    });

    it("returns false for timeout errors", () => {
      const result = detectRateLimit({
        stderr: "Command timed out after 300000ms",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(false);
    });

    it("returns false for permission errors", () => {
      const result = detectRateLimit({
        stderr: "Error: EACCES: permission denied",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(false);
    });
  });

  describe("return value structure", () => {
    it("returns message with context when rate limit detected", () => {
      const result = detectRateLimit({
        stderr: "Rate limit exceeded. Try again in 5 minutes.",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.message).toBeTruthy();
      expect(typeof result.message).toBe("string");
    });

    it("returns empty message when no rate limit", () => {
      const result = detectRateLimit({
        stderr: "Some other error",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(false);
      expect(result.message).toBe("");
    });

    it("includes cooldownUntil and cooldownMs in rate limit result", () => {
      const result = detectRateLimit({
        stderr: "Rate limit exceeded. Retry-After: 60",
        stdout: ""
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.cooldownUntil).toBeTruthy();
      expect(result.cooldownMs).toBe(60000);
    });

    it("includes null cooldown fields for non-rate-limit", () => {
      const result = detectRateLimit({
        stderr: "Some other error",
        stdout: ""
      });
      expect(result.cooldownUntil).toBeNull();
      expect(result.cooldownMs).toBeNull();
    });
  });
});

describe("parseCooldown", () => {
  const FIXED_NOW = new Date("2026-03-07T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses ISO timestamp from Claude rate limit message", () => {
    const result = parseCooldown(
      "usage limit...try again after 2026-03-07T15:30:00Z"
    );
    expect(result.cooldownUntil).toBe("2026-03-07T15:30:00.000Z");
    expect(result.cooldownMs).toBe(
      new Date("2026-03-07T15:30:00Z").getTime() - FIXED_NOW
    );
  });

  it("parses relative seconds from Codex rate limit message", () => {
    const result = parseCooldown(
      "exceeded your current quota. Retry-After: 120"
    );
    expect(result.cooldownMs).toBe(120000);
    expect(result.cooldownUntil).toBeTruthy();
    const parsed = new Date(result.cooldownUntil).getTime();
    expect(parsed).toBe(FIXED_NOW + 120000);
  });

  it("parses 'retry after N seconds' format", () => {
    const result = parseCooldown("retry after 30 seconds");
    expect(result.cooldownMs).toBe(30000);
  });

  it("parses 'retry in Ns' format", () => {
    const result = parseCooldown("retry in 45s");
    expect(result.cooldownMs).toBe(45000);
  });

  it("parses relative minutes from Gemini rate limit message", () => {
    const result = parseCooldown(
      "resource exhausted: retry in 5 minutes"
    );
    expect(result.cooldownMs).toBe(5 * 60 * 1000);
    expect(result.cooldownUntil).toBeTruthy();
    const parsed = new Date(result.cooldownUntil).getTime();
    expect(parsed).toBe(FIXED_NOW + 5 * 60 * 1000);
  });

  it("parses 'wait N min' format", () => {
    const result = parseCooldown("wait 10 min before retrying");
    expect(result.cooldownMs).toBe(10 * 60 * 1000);
  });

  it("parses Claude 'resets at YYYY-MM-DD HH:MM UTC' format", () => {
    const result = parseCooldown(
      "Claude Pro usage limit exceeded. Resets at 2026-03-07 15:30 UTC."
    );
    expect(result.cooldownUntil).toBe("2026-03-07T15:30:00.000Z");
    expect(result.cooldownMs).toBe(
      new Date("2026-03-07T15:30:00Z").getTime() - FIXED_NOW
    );
  });

  it("returns null cooldown when no timestamp in message", () => {
    const result = parseCooldown("Rate limit exceeded. Please try again later.");
    expect(result.cooldownUntil).toBeNull();
    expect(result.cooldownMs).toBeNull();
  });

  it("returns null cooldown for non-rate-limit messages", () => {
    const result = parseCooldown("File not found: config.json");
    expect(result.cooldownUntil).toBeNull();
    expect(result.cooldownMs).toBeNull();
  });

  it("handles empty string", () => {
    const result = parseCooldown("");
    expect(result.cooldownUntil).toBeNull();
    expect(result.cooldownMs).toBeNull();
  });

  it("handles null/undefined input", () => {
    expect(parseCooldown(null)).toEqual({ cooldownUntil: null, cooldownMs: null });
    expect(parseCooldown(undefined)).toEqual({ cooldownUntil: null, cooldownMs: null });
  });

  it("handles garbage input", () => {
    const result = parseCooldown("asdkjh1234!@#$%^&*()zxcvbnm");
    expect(result.cooldownUntil).toBeNull();
    expect(result.cooldownMs).toBeNull();
  });

  it("clamps cooldownMs to 0 when timestamp is in the past", () => {
    const result = parseCooldown(
      "try again after 2026-03-07T11:00:00Z"
    );
    expect(result.cooldownMs).toBe(0);
    expect(result.cooldownUntil).toBe("2026-03-07T11:00:00.000Z");
  });
});

describe("parseCooldown — 12-hour clock (Claude Code session limit)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T17:24:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses 'resets 10:10pm (Europe/Madrid)' to 22:10 Madrid wall-clock (TZ-aware)", () => {
    // KJC-BUG-0064 — verify the Madrid wall-clock regardless of host TZ.
    const { cooldownUntil, cooldownMs } = parseCooldown(
      "You've hit your session limit · resets 10:10pm (Europe/Madrid)"
    );
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(cooldownUntil)).reduce((a, p) => (p.type !== "literal" ? { ...a, [p.type]: p.value } : a), {});
    expect(parts.hour).toBe("22");
    expect(parts.minute).toBe("10");
    expect(cooldownMs).toBeGreaterThan(0);
  });

  it("rolls over to the next day when the reset time already passed", () => {
    vi.setSystemTime(new Date("2026-05-22T23:00:00"));
    const { cooldownUntil } = parseCooldown("resets 10:10pm");
    expect(new Date(cooldownUntil).getDate()).toBe(23);
  });

  it("handles the hour-only form 'resets 4am'", () => {
    const { cooldownUntil } = parseCooldown("your limit resets 4am");
    expect(new Date(cooldownUntil).getHours()).toBe(4);
  });
});

describe("detectRateLimit — Claude Code session limit", () => {
  it("detects 'hit your session limit' as a Claude rate limit", () => {
    const result = detectRateLimit({
      stderr: "You've hit your session limit · resets 10:10pm (Europe/Madrid)",
      stdout: "",
    });
    expect(result.isRateLimit).toBe(true);
    expect(result.agent).toBe("claude");
  });
});
