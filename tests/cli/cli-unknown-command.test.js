/**
 * Integration test for the CLI's unknown-command guard.
 *
 * Pre-fix, typing `kj generate plan --task-file SPEC.md` produced
 * `error: unknown option '--task-file'` — confusing because the *real*
 * problem was that 'generate' isn't a top-level subcommand (it lives
 * under `kj plan generate`). The guard catches this case before
 * Commander's option parsing runs and emits a "no such command"
 * message with a suggested alternative.
 *
 * We spawn the actual CLI script. Loading it in-process via dynamic
 * import would also work, but the CLI uses `process.exit()` directly
 * in the unknown-command branch — easier and more honest to fork it.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli.js");

function runKj(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("CLI unknown-command guard", () => {
  it("rejects an unknown top-level command with a clear error and exit 1", () => {
    const r = runKj(["generate", "plan", "--task-file", "SPEC.md"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/'generate' no es un comando válido/);
    // Must NOT leak Commander's "unknown option" — that's the bug.
    expect(r.stderr).not.toMatch(/unknown option/);
  });

  it("suggests the closest valid command when the user typos a known one", () => {
    const r = runKj(["plat"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/'plat' no es un comando válido/);
    expect(r.stderr).toMatch(/¿Quisiste decir 'plan'/);
  });

  it("lists the available commands so the user can pick one", () => {
    const r = runKj(["nope"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Comandos disponibles:/);
    // Spot-check a few well-known top-level commands appear in the list.
    expect(r.stderr).toContain("plan");
    expect(r.stderr).toContain("run");
    expect(r.stderr).toContain("doctor");
  });

  it("points the user at --help for more info", () => {
    const r = runKj(["nope"]);
    expect(r.stderr).toMatch(/'kj --help'/);
  });

  it("still shows the welcome screen when invoked with no args", () => {
    const r = runKj([]);
    expect(r.code).toBe(0);
    // Welcome screen writes to stdout, not stderr — and includes the version.
    // Loading config can take a moment; we just check the run succeeded with
    // some stdout content.
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  it("propagates Commander's option-typo suggestion to subcommands", () => {
    // `--task-fil` is a 1-char typo of `--task-file`. With
    // showSuggestionAfterError(true), Commander should hint at the
    // correct flag inside subcommands too.
    const r = runKj(["plan", "generate", "--task-fil", "SPEC.md"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/--task-file/);
  });
});
