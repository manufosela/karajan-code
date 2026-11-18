import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountEnv, accountsProblem, expandHome, pickDefaultAccount } from "../../src/config/accounts.js";
import { safeParseConfig } from "../../src/config/schema.js";

const dir = mkdtempSync(join(tmpdir(), "kj-acct-"));
const work = { id: "work", provider: "claude", home: dir, default: true };

describe("accounts", () => {
  it("returns {} when nothing is configured", () => {
    expect(accountEnv(undefined, "claude")).toEqual({});
    expect(accountEnv([{ ...work, default: false }], "claude")).toEqual({});
  });

  it("maps the default account to the provider variable", () => {
    expect(accountEnv([work], "claude")).toEqual({ CLAUDE_CONFIG_DIR: dir });
    expect(accountEnv([{ ...work, id: "cx", provider: "codex" }], "codex")).toEqual({ CODEX_HOME: dir });
    expect(accountEnv([work], "codex")).toEqual({});
  });

  it("picks the default of the provider", () => {
    const other = { ...work, id: "b", default: false };
    expect(pickDefaultAccount([other, work], "claude")).toBe(work);
  });

  it("expands ~ in home", () => {
    expect(expandHome("~/x")).not.toContain("~");
    expect(expandHome("/abs")).toBe("/abs");
  });

  it("throws naming id and path when the directory is missing", () => {
    const missing = join(dir, "nope");
    expect(() => accountEnv([{ ...work, home: missing }], "claude")).toThrow(/"work".*nope/);
  });

  it.each([
    ["unknown provider", [{ ...work, provider: "gemini" }], /"work".*unknown provider/],
    ["duplicate id", [work, { ...work, provider: "codex" }], /duplicate.*"work"/],
    ["two defaults", [work, { ...work, id: "b" }], /"b".*second default/],
  ])("rejects %s, naming the entry", (_n, list, re) => {
    expect(accountsProblem(list)).toMatch(re);
    const result = safeParseConfig({ accounts: list });
    expect(result.success).toBe(false);
    expect(result.issues.map((i) => i.message).join(" ")).toMatch(re);
  });

  it("accepts a valid list in the schema", () => {
    expect(safeParseConfig({ accounts: [work] }).success).toBe(true);
  });
});
