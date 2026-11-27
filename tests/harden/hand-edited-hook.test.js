import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hardenCommand } from "../../src/commands/harden.js";
import { installHooks } from "../../src/harden/harden-engine.js";
import { PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";

const CURRENT = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
let repo;
const hookPath = () => join(repo, ".karajan", "hooks", "pre-commit");
const read = () => readFileSync(hookPath(), "utf8");
const actionOf = (res) => res.hooks.find((h) => h.hook === "pre-commit").action;

const insertInBlock = (line) =>
  writeFileSync(hookPath(), read().replace(/(>>> kj:managed:hook:pre-commit .*\n)/, `$1${line}\n`));

/** Install with generation G and, unless told not to, record it as a seal would. */
async function install({ sealed = true, kjVersion = CURRENT, baseBranch = "main" } = {}) {
  const { generation } = await installHooks({ projectDir: repo, baseBranch });
  if (sealed) seal(generation, kjVersion);
}

function seal(generation, kjVersion = CURRENT) {
  const sha = createHash("sha256").update(read()).digest("hex");
  const files = [{ file: ".karajan/hooks/pre-commit", sha256: sha }];
  writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ kj_version: kjVersion, generation, files }));
}

/** The template changes: another base branch renders another pre-commit. */
const refresh = (opts = {}) => installHooks({ projectDir: repo, baseBranch: "develop", ...opts });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-edited-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("installHooks over a hook edited by hand (HU-4997)", () => {
  it.each([false, true])("leaves it untouched and reports kept-edited (dryRun=%s)", async (dryRun) => {
    await install();
    insertInBlock("echo BY_HAND");
    const before = read();
    expect(actionOf(await refresh({ dryRun }))).toBe("kept-edited");
    expect(read()).toBe(before);
  });

  it.each(["", "echo OUTSIDE\n"])("refreshes a block that is what kj wrote and keeps what is outside it (%j)", async (outside) => {
    await install();
    appendFileSync(hookPath(), outside);
    expect(actionOf(await refresh())).toBe("updated");
    expect(read()).toContain("develop");
    expect(read().endsWith(`<<< kj:managed:hook:pre-commit <<<\n${outside}`)).toBe(true);
  });

  // A seal from before generation.bodySha256: another kj whose template this kj cannot re-render.
  it.each(["before", "after"])("refreshes a hook sealed by another kj version, a line outside added %s the seal", async (when) => {
    await install();
    insertInBlock("# as an older kj wrote it");
    if (when === "before") appendFileSync(hookPath(), "echo OUTSIDE\n");
    seal({ profile: "standard", cmds: {}, baseBranch: "main" }, "0.0.1");
    if (when === "after") appendFileSync(hookPath(), "echo OUTSIDE\n");
    expect(actionOf(await refresh())).toBe("updated");
    expect(read()).toContain("echo OUTSIDE");
  });

  it("with the body digests of a seal of another kj version, no line outside the block freezes it", async () => {
    // Another kj rendered main as this block (this kj renders it otherwise): the seal says what it wrote.
    const { generation } = await installHooks({ projectDir: repo, baseBranch: "trunk" });
    appendFileSync(hookPath(), "echo BEFORE_SEAL\n");
    seal({ ...generation, baseBranch: "main" }, "0.0.1");
    appendFileSync(hookPath(), "echo AFTER_SEAL\n");
    expect(actionOf(await refresh())).toBe("updated");
    expect(read()).toMatch(/develop[\s\S]*echo BEFORE_SEAL\necho AFTER_SEAL\n$/);
  });

  it.each([true, false].flatMap((digests) => ["before", "after"].map((when) => ({ digests, when }))))("refreshes a hook that core.autocrlf turned CRLF $when a seal by another kj (body digests: $digests)", async ({ digests, when }) => {
    const { generation } = await installHooks({ projectDir: repo, baseBranch: "trunk" });
    appendFileSync(hookPath(), "echo OUTSIDE\n");
    const crlf = () => writeFileSync(hookPath(), read().replaceAll("\n", "\r\n"));
    if (when === "before") crlf();
    seal({ ...generation, baseBranch: "main", bodySha256: digests ? generation.bodySha256 : undefined }, "0.0.1");
    if (when === "after") crlf();
    expect(actionOf(await refresh())).toBe("updated");
    expect(read()).toContain("develop");
  });

  it.each([null, { files: [] }])("with no generation sealed behaves as before (provenance %j)", async (provenance) => {
    await install({ sealed: false });
    if (provenance) writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify(provenance));
    insertInBlock("echo BY_HAND");
    expect(actionOf(await refresh())).toBe("updated");
  });
});

describe("kj harden over a hook edited by hand (HU-4997)", () => {
  const run = async (dryRun) => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await hardenCommand({ projectDir: repo, config: false, ci: false, guidelines: false, dryRun, logger });
    return logger.warn.mock.calls.map(([line]) => line).filter((line) => line.includes("edited by hand"));
  };

  it.each([false, true])("warns about the kept hook and what to do (dryRun=%s)", async (dryRun) => {
    // This repo resolves to main, so a hook generated for trunk is one whose template changes.
    await install({ baseBranch: "trunk" });
    insertInBlock("echo BY_HAND");
    expect(await run(dryRun)).toEqual([
      "⚠ pre-commit has a managed block edited by hand, so kj harden left it as it is. If kj generated something that does not fit this project, say it in .karajan/kj.config.yml (for example base_branch), then delete .karajan/hooks/pre-commit and run kj harden: kj writes it again with your settings.",
    ]);
    expect(read()).toContain("echo BY_HAND");
  });

  it("does not warn when the hook is what kj wrote", async () => {
    await install({ baseBranch: "trunk" });
    expect(await run(false)).toEqual([]);
  });
});
