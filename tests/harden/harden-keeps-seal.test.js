/**
 * KJC-BUG-0193 asked kj harden not to rewrite the guards a human sealed, because
 * rewriting them un-sealed the ones running. KJC-TSK-1208 (ADR 0030) removes the
 * question: kj harden writes no guard into the project, the hooks run the
 * installed kj's, and the copies an older kj left are retired, sealed or not (the
 * next seal records them as deleted). Nothing that runs is touched by a harden.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

let repo;
const quiet = { info: () => {}, warn: () => {} };
const harness = (name) => join(repo, ".karajan", "harness", name);

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-seal-"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
  placeGuardCopies(repo); // what an older kj left in the project
  writeFileSync(harness("sentinel-state.json"), '{"sessions":{}}');
  writeFileSync(harness("denials.jsonl"), "{}\n");
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("kj harden retires the guard copies (KJC-TSK-1208)", () => {
  it("wires the installed kj's guards and retires every copy, keeping the state and the denial log", () => {
    const res = installSentinelHooks({ projectDir: repo, logger: quiet });
    expect(res.wired).toBe(true);
    expect(res.retired).toEqual(expect.arrayContaining(["stop.mjs", "pretooluse-sentinel.mjs", "sentinel-lib.mjs", "installed.json"]));
    for (const name of ["stop.mjs", "posttooluse.mjs", "pretooluse-sentinel.mjs", "installed.json"]) expect(existsSync(harness(name)), name).toBe(false);
    expect(existsSync(harness("sentinel-state.json"))).toBe(true);
    expect(existsSync(harness("denials.jsonl"))).toBe(true);
  });

  it("a second harden has nothing left to retire", () => {
    installSentinelHooks({ projectDir: repo, logger: quiet });
    expect(installSentinelHooks({ projectDir: repo, logger: quiet }).retired).toEqual([]);
  });

  it("when the hooks cannot be wired, the copies that still run stay where they are", () => {
    writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: { weird: true } } }));
    const res = installSentinelHooks({ projectDir: repo, logger: quiet });
    expect(res.wired).toBe(false);
    expect(res.retired).toEqual([]);
    expect(existsSync(harness("stop.mjs"))).toBe(true);
  });
});
