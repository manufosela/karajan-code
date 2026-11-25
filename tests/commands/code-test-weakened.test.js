// HU-4872 (KJC-TSK-1762): kj code treats a coder that removes an assertion from an existing test as failed.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const { resolveCardContext } = await import("../../src/prompts/card-context.js");
const { codeCommand } = await import("../../src/commands/code.js");

let repo;
let exitBefore;
const logger = { ...createNoopLoggerWithContext(), error: vi.fn(), info: vi.fn() };
const config = () => ({ projectDir: repo, coder: "claude", roles: { coder: { provider: "claude" } }, development: { methodology: "tdd" } });
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
const coderWrites = (body) => createAgent.mockReturnValue({
  runTask: vi.fn(async () => { writeFileSync(join(repo, "tests/sum.test.js"), body); return { ok: true, output: "done", exitCode: 0 }; }),
});

beforeEach(() => {
  exitBefore = process.exitCode;
  repo = mkdtempSync(join(tmpdir(), "kj-code-weakened-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  git("init", "-q");
  mkdirSync(join(repo, "tests"));
  writeFileSync(join(repo, "tests/sum.test.js"), "it(\"adds\", () => {\n  expect(sum(1, 2)).toBe(3);\n  done();\n});\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
});
afterEach(() => { process.exitCode = exitBefore; vi.restoreAllMocks(); rmSync(repo, { recursive: true, force: true }); });

describe("kj code and a weakened test (HU-4872)", () => {
  it.each([["kj code --retry", null], ["kj code --card HU-9 --retry", "HU-9"]])("fails the coder that removes an assertion and asks for: %s", async (retry, card) => {
    resolveCardContext.mockResolvedValueOnce(card ? { huId: card, title: "sum" } : null);
    coderWrites("it(\"adds\", () => {\n  done();\n});\n");
    const result = await codeCommand({ task: "t", config: config(), logger, flags: { card } });
    expect(result.ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("tests/sum.test.js:2 removes the assertion expect(sum(1, 2)).toBe(3);"));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`Restore the assertion and run: ${retry}`));
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("The work is in the tree"));
  });

  it("lets a coder that keeps its assertions through", async () => {
    coderWrites("it(\"adds\", () => {\n  expect(sum(1, 2)).toBe(3);\n  done();\n  done();\n});\n");
    const result = await codeCommand({ task: "t", config: config(), logger });
    expect(result.ok).toBe(true);
    expect(process.exitCode).toBe(exitBefore);
  });
});
