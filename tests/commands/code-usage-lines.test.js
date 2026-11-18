// HU-4619: kj code hands its coder's call a measure of the lines it writes, for the usage record.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

vi.mock("../../src/agents/index.js", () => ({ createAgent: vi.fn() }));
vi.mock("../../src/agents/availability.js", () => ({ assertAgentsAvailable: vi.fn() }));
vi.mock("../../src/prompts/coder.js", () => ({ buildCoderPrompt: vi.fn(async () => "coder prompt") }));
vi.mock("../../src/commands/rag.js", () => ({ ragQueryCommand: vi.fn(async () => []) }));
vi.mock("../../src/prompts/card-context.js", () => ({ resolveCardContext: vi.fn(async () => null) }));

const { createAgent } = await import("../../src/agents/index.js");
const { codeCommand } = await import("../../src/commands/code.js");

let repo;
let measured;
const logger = { ...createNoopLoggerWithContext(), warn: vi.fn() };
const config = () => ({ projectDir: repo, coder: "claude", roles: { coder: { provider: "claude" } }, development: { methodology: "tdd" } });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-code-lines-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  createAgent.mockReturnValue({
    runTask: vi.fn(async (task) => {
      writeFileSync(join(repo, "new.js"), "a\nb\nc\n");
      measured = task.measureLines?.();
      return { ok: true, output: "done", exitCode: 0 };
    }),
  });
});
afterEach(() => { vi.restoreAllMocks(); rmSync(repo, { recursive: true, force: true }); measured = undefined; });

describe("kj code and the usage record (HU-4619)", () => {
  it("measures the lines its coder writes in a git repo", async () => {
    // As in a hardened repo, kj's own state (the activity trace) is ignored and never counts as the coder's lines.
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(join(repo, ".gitignore"), ".karajan/*\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"], { cwd: repo });
    await codeCommand({ task: "t", config: config(), logger });
    expect(measured).toEqual({ linesAdded: 3, linesRemoved: 0 });
  });

  it("warns and passes no measure outside git", async () => {
    await codeCommand({ task: "t", config: config(), logger });
    expect(measured).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/usage: the coder's lines go unrecorded/));
  });
});
