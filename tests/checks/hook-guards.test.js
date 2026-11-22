// HU-4795: kj doctor says when the installed kj-hook does not know a guard the hooks wire.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHookGuardChecks } from "../../src/checks/hook-guards.js";
import { GUARD_PROBE, guardsFromRefusal, runGuard } from "../../src/harden/sentinel-guards.js";

const refusal = (names) => `kj-hook: "${GUARD_PROBE}" is not a Sentinel guard (${names.join(", ")}) — run kj harden`;
let dir;

const wire = (file, event, guard) => {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const command = `if command -v kj-hook >/dev/null 2>&1; then kj-hook ${guard}; fi`;
  writeFileSync(join(dir, ".claude", file), JSON.stringify({ hooks: { [event]: [{ hooks: [{ type: "command", command }] }] } }));
};
const detect = (opts) => getHookGuardChecks({ projectDir: dir, ...opts })[0].detect();
const knows = (names) => ({ onPath: () => true, probe: () => ({ stderr: refusal(names) }) });

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hook-guards-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("hook-guards check", () => {
  it("fails naming the unknown guard, its file and event", async () => {
    wire("settings.local.json", "PreToolUse", "presence");
    const result = await detect(knows(["pretooluse-sentinel"]));
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("fail");
    expect(result.detail).toContain(".claude/settings.local.json PreToolUse → kj-hook presence");
    expect(result.fix).toContain("kj harden");
  });

  it("passes when the installed kj-hook knows every wired guard", async () => {
    wire("settings.json", "Stop", "presence");
    expect((await detect(knows(["presence", "other"]))).ok).toBe(true);
  });

  it("passes when no hook runs kj-hook", async () => {
    const result = await detect(knows([]));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("no hook");
  });

  it("passes when kj-hook is not on the PATH", async () => {
    wire("settings.json", "Stop", "presence");
    const result = await detect({ onPath: () => false, probe: () => { throw new Error("must not run"); } });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("PATH");
  });

  it("fails when the answer cannot be read", async () => {
    wire("settings.json", "Stop", "presence");
    const result = await detect({ onPath: () => true, probe: () => ({ stderr: "boom" }) });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("cannot read the guards of the installed kj-hook");
  });
});

describe("guardsFromRefusal", () => {
  it("reads the very message runGuard prints for an unknown name", async () => {
    const errors = [];
    await runGuard(GUARD_PROBE, { logger: { error: (text) => errors.push(text) }, exit: () => {}, guards: { a: 1, b: 2 } });
    expect(guardsFromRefusal(errors[0])).toEqual(["a", "b"]);
  });

  it("returns null for any other text", () => {
    expect(guardsFromRefusal("something else")).toBeNull();
  });
});
