// KJC-TSK-1237 (#2565): the coder's files leave its stage formatted, so a
// format check never aborts the final commit after every gate was green.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runFormatStage } from "../../src/orchestrator/stages/format-stage.js";

let repo;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-format-"));
  mkdirSync(join(repo, "pkg"));
  for (const f of ["app.py", "notes.py", "README.md", "pkg/new.py"]) writeFileSync(join(repo, f), "x = 1\n");
});
afterEach(() => { chmodSync(join(repo, "pkg"), 0o755); rmSync(repo, { recursive: true, force: true }); });

const stage = (overrides = {}) => {
  const events = [];
  const runImpl = vi.fn(async () => ({ exitCode: 0 }));
  const args = {
    config: { projectDir: repo },
    logger: { warn: vi.fn(), info: vi.fn() },
    emitter: { emit: (_e, data) => events.push(data) },
    eventBase: { sessionId: "s1", iteration: 1, stage: null, startedAt: 0 },
    session: { git_preexisting: ["notes.py"] },
    detectLanguageImpl: () => "python",
    listPendingImpl: async () => ["app.py", "notes.py", "README.md", "gone.py", "pkg/"],
    runImpl,
    ...overrides,
  };
  return { args, events, runImpl };
};

describe("format stage", () => {
  it("formats only the session's files of the language, without a shell", async () => {
    const { args, events, runImpl } = stage();
    const r = await runFormatStage(args);
    expect(r).toEqual({ ran: true, ok: true, files: ["app.py", "pkg/new.py"] });
    expect(runImpl).toHaveBeenCalledWith("ruff", ["format", "--", "app.py", "pkg/new.py"], expect.objectContaining({ cwd: repo }));
    expect(events.find((e) => e.type === "format:result")).toMatchObject({ status: "ok" });
  });

  it("runs the formatter through uv when the project uses it", async () => {
    writeFileSync(join(repo, "uv.lock"), "");
    const { args, runImpl } = stage();
    await runFormatStage(args);
    expect(runImpl).toHaveBeenCalledWith("uv", ["run", "ruff", "format", "--", "app.py", "pkg/new.py"], expect.anything());
  });

  it.each([
    ["fails", async () => ({ exitCode: 127 }), "127"],
    ["cannot even start", async () => { throw new Error("spawn ruff ENOENT"); }, "none"],
  ])("a formatter that %s is said and the run goes on", async (_why, impl, exit) => {
    const { args, events } = stage({ runImpl: vi.fn(impl) });
    expect(await runFormatStage(args)).toMatchObject({ ran: true, ok: false });
    expect(args.logger.warn).toHaveBeenCalledWith(expect.stringContaining(`ruff format failed (exit ${exit})`));
    expect(events.find((e) => e.type === "format:result")).toMatchObject({ status: "warn" });
  });
  it("without a baseline of what was pending, nothing is formatted", async () => {
    const { args, runImpl } = stage({ session: {} });
    expect(await runFormatStage(args)).toMatchObject({ ran: false });
    expect(runImpl).not.toHaveBeenCalled();
    expect(args.logger.warn).toHaveBeenCalledWith(expect.stringMatching(/no baseline/));
  });

  it.each([
    ["git cannot list the pending files", async () => { throw new Error("not a git repository"); }, /not a git repository/],
    ["a new directory cannot be read", async () => { chmodSync(join(repo, "pkg"), 0); return ["pkg/"]; }, /EACCES/],
  ])("nothing is formatted when %s, and it is said", async (_why, listPendingImpl, said) => {
    const { args, runImpl } = stage({ listPendingImpl });
    expect(await runFormatStage(args)).toMatchObject({ ran: false });
    expect(runImpl).not.toHaveBeenCalled();
    expect(args.logger.warn).toHaveBeenCalledWith(expect.stringMatching(said));
  });

  it.each([
    ["the project opts out", { config: { development: { format_after_coder: false } } }],
    ["a JS project declares no formatter", { detectLanguageImpl: () => "javascript" }],
    ["no file of the language changed", { listPendingImpl: async () => ["README.md"] }],
  ])("does nothing when %s", async (_why, overrides) => {
    const { args, runImpl } = stage(overrides);
    if (overrides.config) args.config = { projectDir: repo, ...overrides.config };
    expect(await runFormatStage(args)).toMatchObject({ ran: false });
    expect(runImpl).not.toHaveBeenCalled();
  });

  // KJC-TSK-1239: a JS/TS project is formatted with the formatter it declares, from node_modules.
  const jsProject = (pkg, bins) => {
    writeFileSync(join(repo, "package.json"), JSON.stringify(pkg));
    mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
    for (const b of bins) writeFileSync(join(repo, "node_modules", ".bin", b), "");
    for (const f of ["src.ts", "view.jsx"]) writeFileSync(join(repo, f), "x\n");
  };
  const jsStage = () => stage({ detectLanguageImpl: () => "typescript", listPendingImpl: async () => ["src.ts", "view.jsx", "README.md", "app.py"] });
  it.each([
    ["prettier", { devDependencies: { prettier: "^3" } }, "node_modules/.bin/prettier", ["--write"]],
    ["biome", { devDependencies: { "@biomejs/biome": "^1" } }, "node_modules/.bin/biome", ["format", "--write"]],
    ["the one its scripts use when both are declared", { scripts: { "format:check": "biome format ." }, devDependencies: { prettier: "^3", "@biomejs/biome": "^1" } }, "node_modules/.bin/biome", ["format", "--write"]],
  ])("a JS/TS project is formatted with %s", async (_which, pkg, bin, flags) => {
    jsProject(pkg, ["prettier", "biome"]);
    const { args, runImpl } = jsStage();
    expect(await runFormatStage(args)).toMatchObject({ ran: true, ok: true, files: ["src.ts", "view.jsx"] });
    expect(runImpl).toHaveBeenCalledWith(bin, [...flags, "--", "src.ts", "view.jsx"], expect.objectContaining({ cwd: repo }));
  });
  it("a declared formatter that is not installed formats nothing", async () => {
    jsProject({ devDependencies: { prettier: "^3" } }, []);
    const { args, runImpl } = jsStage();
    expect(await runFormatStage(args)).toMatchObject({ ran: false });
    expect(runImpl).not.toHaveBeenCalled();
  });
});
