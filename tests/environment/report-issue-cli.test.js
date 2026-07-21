// AB-F 2/2 (KJC-TSK-0655): the CLI. Default NEVER publishes (preview +
// prefilled URL); similar issues block unless --force; --publish requires
// gh and fails actionably without it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportIssueCommand } from "../../src/commands/report-issue.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const fetchNone = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
const fetchSimilar = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => [{ number: 12, title: "SEA binary breaks karajan-mcp better-sqlite3", html_url: "u12" }],
});

describe("kj report-issue", () => {
  beforeEach(() => { vi.clearAllMocks(); process.exitCode = 0; });

  it("default: preview + prefilled URL, nothing published", async () => {
    const runCmd = vi.fn();
    const res = await reportIssueCommand({
      logger, flags: { title: "Something broke badly", error: "boom at /home/manu/x" },
      deps: { fetchFn: fetchNone, runCmd },
    });
    expect(res.published).toBe(false);
    expect(res.url).toMatch(/issues\/new\?/);
    expect(res.body).not.toMatch(/\/home\/manu/);
    expect(runCmd).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("similar issues found → blocks with the list (exit 1) unless --force", async () => {
    const res = await reportIssueCommand({
      logger, flags: { title: "SEA binary better-sqlite3 missing karajan-mcp" },
      deps: { fetchFn: fetchSimilar, runCmd: vi.fn() },
    });
    expect(res.published).toBe(false);
    expect(res.similar).toHaveLength(1);
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    const forced = await reportIssueCommand({
      logger, flags: { title: "SEA binary better-sqlite3 missing karajan-mcp", force: true },
      deps: { fetchFn: fetchSimilar, runCmd: vi.fn() },
    });
    expect(process.exitCode).toBe(0);
    expect(forced.url).toMatch(/issues\/new/);
  });

  it("--publish creates the issue via gh and returns its URL", async () => {
    const runCmd = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "https://github.com/manufosela/karajan-code/issues/99\n" });
    const res = await reportIssueCommand({
      logger, flags: { title: "Broken thing entirely", publish: true },
      deps: { fetchFn: fetchNone, runCmd },
    });
    expect(res.published).toBe(true);
    expect(res.url).toMatch(/issues\/99/);
    const [bin, args] = runCmd.mock.calls[0];
    expect(bin).toBe("gh");
    expect(args).toEqual(expect.arrayContaining(["issue", "create"]));
  });

  it("--publish without a working gh → actionable error including the manual URL", async () => {
    const runCmd = vi.fn().mockRejectedValue(new Error("gh: not found"));
    const res = await reportIssueCommand({
      logger, flags: { title: "Broken thing entirely", publish: true },
      deps: { fetchFn: fetchNone, runCmd },
    });
    expect(res.published).toBe(false);
    expect(res.url).toMatch(/issues\/new\?/);
    expect(process.exitCode).toBe(1);
  });

  it("missing title → error", async () => {
    await expect(reportIssueCommand({ logger, flags: {}, deps: { fetchFn: fetchNone, runCmd: vi.fn() } }))
      .rejects.toThrow(/--title/);
  });
});
