import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setRescue, rescueFor, rescueKey, rescueDecision } from "../../src/accounts/rescue.js";

const KEY = "sk-secret-123";
let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rescue-")); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const at = (hour) => new Date(2026, 0, 15, hour, 30);
const decide = (over = {}) => rescueDecision({
  rules: {}, hasKey: true, now: at(12), spent: { day: 0, month: 0 }, role: "coder", model: "m1", limitReached: false, ...over,
});

describe("rescue storage", () => {
  it("stores in rescue.json with mode 0600, never in accounts.json", () => {
    setRescue("claude", { key: KEY, rules: { roles: ["coder"] } }, { home });
    const file = path.join(home, "rescue.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(home, "accounts.json"))).toBe(false);
    expect(rescueKey("claude", { home })).toBe(KEY);
  });

  it("rescueFor returns rules and hasKey, never the key", () => {
    expect(rescueFor("claude", { home })).toEqual({ rules: {}, hasKey: false });
    setRescue("claude", { key: KEY, rules: { dailyBudget: 5 } }, { home });
    const view = rescueFor("claude", { home });
    expect(view).toEqual({ rules: { dailyBudget: 5 }, hasKey: true });
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it("rejects an unknown provider and a missing key without echoing the key", () => {
    expect(() => setRescue("nope", { key: KEY, rules: {} }, { home })).toThrow(/unknown provider/);
    expect(() => setRescue("claude", { key: "", rules: {} }, { home })).toThrow(/key/);
  });

  it("rejects invalid rules loudly", () => {
    const bad = [
      { dailyBudget: -1 }, { monthlyBudget: "5" }, { roles: "coder" }, { models: "m" }, { roles: [1] },
      { when: { limit: "yes" } }, { when: { window: { from: 24, to: 3 } } }, { when: { window: { from: 3 } } },
      { when: { window: { from: 5, to: 5 } } },
    ];
    for (const rules of bad) {
      expect(() => setRescue("claude", { key: KEY, rules }, { home }), JSON.stringify(rules)).toThrow(/^rescue: (?!.*sk-secret)/);
    }
  });

  it("a corrupt file fails loudly without leaking its content", () => {
    fs.writeFileSync(path.join(home, "rescue.json"), `{"claude": {"key": "${KEY}"`);
    expect(() => rescueFor("claude", { home })).toThrow(/^rescue: (?!.*sk-secret)/);
  });
});

describe("rescueDecision", () => {
  it("allows with no rules", () => expect(decide()).toEqual({ allow: true }));
  it("denies no-key first", () => expect(decide({ hasKey: false, role: "x" })).toEqual({ allow: false, reason: "no-key" }));

  it("not-yet: limit rule unmet and outside the window", () => {
    const rules = { when: { limit: true, window: { from: 22, to: 23 } } };
    expect(decide({ rules })).toEqual({ allow: false, reason: "not-yet" });
    expect(decide({ rules, limitReached: true })).toEqual({ allow: true });
    expect(decide({ rules, now: at(22) })).toEqual({ allow: true });
  });

  it("window crossing midnight", () => {
    const rules = { when: { window: { from: 22, to: 6 } } };
    expect(decide({ rules, now: at(23) }).allow).toBe(true);
    expect(decide({ rules, now: at(3) }).allow).toBe(true);
    expect(decide({ rules, now: at(6) }).reason).toBe("not-yet");
    expect(decide({ rules, now: at(12) }).reason).toBe("not-yet");
  });

  it("role and model", () => {
    expect(decide({ rules: { roles: ["reviewer"] } }).reason).toBe("role");
    expect(decide({ rules: { roles: ["coder"] } }).allow).toBe(true);
    expect(decide({ rules: { models: [] } }).reason).toBe("model");
    expect(decide({ rules: { models: ["m2"] } }).reason).toBe("model");
    expect(decide({ rules: { models: ["m1"] } }).allow).toBe(true);
  });

  it("budgets: exactly spent is denied, unset is uncapped", () => {
    expect(decide({ rules: { dailyBudget: 5 }, spent: { day: 5, month: 5 } }).reason).toBe("daily-budget");
    expect(decide({ rules: { dailyBudget: 5 }, spent: { day: 4.99, month: 99 } }).allow).toBe(true);
    expect(decide({ rules: { monthlyBudget: 10 }, spent: { day: 0, month: 10 } }).reason).toBe("monthly-budget");
    expect(decide({ rules: { monthlyBudget: 0 } }).reason).toBe("monthly-budget");
  });

  it("checks in the documented order", () => {
    const rules = { when: { limit: true }, roles: ["x"], models: [], dailyBudget: 1, monthlyBudget: 1 };
    const spent = { day: 1, month: 1 };
    expect(decide({ rules, spent }).reason).toBe("not-yet");
    expect(decide({ rules, spent, limitReached: true }).reason).toBe("role");
    expect(decide({ rules: { ...rules, roles: ["coder"] }, spent, limitReached: true }).reason).toBe("model");
    expect(decide({ rules: { ...rules, roles: ["coder"], models: ["m1"] }, spent, limitReached: true }).reason).toBe("daily-budget");
  });
});
