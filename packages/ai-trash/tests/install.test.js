// install --claude-code tests (KJC-TSK-0390 commit 3).
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { installClaudeCodeHook, patchSettings, HOOK_COMMAND, LEGACY_HOOK_COMMAND } from "../src/install.js";

async function makeSettings(initial) {
  const dir = await mkdtemp(join(tmpdir(), "ai-trash-install-"));
  const path = join(dir, "settings.json");
  if (initial !== undefined) await writeFile(path, JSON.stringify(initial, null, 2), "utf8");
  return path;
}

describe("patchSettings (pure)", () => {
  it("adds PreToolUse + Bash matcher when hooks is missing", () => {
    const { settings, mutated } = patchSettings({ theme: "dark" });
    expect(mutated).toBe(true);
    expect(settings.theme).toBe("dark");
    expect(settings.hooks.PreToolUse).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: HOOK_COMMAND }] },
    ]);
  });

  it("appends to existing Bash matcher without dropping siblings", () => {
    const initial = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "other-tool" }] },
          { matcher: "Read", hooks: [{ type: "command", command: "x" }] },
        ],
      },
    };
    const { settings, mutated } = patchSettings(initial);
    expect(mutated).toBe(true);
    const bash = settings.hooks.PreToolUse.find((e) => e.matcher === "Bash");
    expect(bash.hooks).toHaveLength(2);
    expect(bash.hooks.at(-1).command).toBe(HOOK_COMMAND);
    const read = settings.hooks.PreToolUse.find((e) => e.matcher === "Read");
    expect(read.hooks[0].command).toBe("x");
  });

  it("is idempotent when the kj-trash hook already exists", () => {
    const initial = {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: HOOK_COMMAND }] }],
      },
    };
    const { mutated } = patchSettings(initial);
    expect(mutated).toBe(false);
  });
});

describe("installClaudeCodeHook (filesystem)", () => {
  it("creates settings.json when missing", async () => {
    const path = await makeSettings();
    const res = await installClaudeCodeHook({ path });
    expect(res.mutated).toBe(true);
    const written = JSON.parse(await readFile(path, "utf8"));
    expect(written.hooks.PreToolUse[0].hooks[0].command).toBe(HOOK_COMMAND);
  });

  it("preserves other top-level keys when patching", async () => {
    const path = await makeSettings({ theme: "dark", language: "es" });
    await installClaudeCodeHook({ path });
    const written = JSON.parse(await readFile(path, "utf8"));
    expect(written.theme).toBe("dark");
    expect(written.language).toBe("es");
    expect(written.hooks.PreToolUse).toHaveLength(1);
  });

  it("returns mutated:false on second run (idempotent)", async () => {
    const path = await makeSettings();
    await installClaudeCodeHook({ path });
    const second = await installClaudeCodeHook({ path });
    expect(second.mutated).toBe(false);
  });
});

// KJC-BUG-0095: the net must never go down silently. The installed line
// fails CLOSED when the bin is off PATH, and old installs upgrade in place.
describe("fail-closed hook line (KJC-BUG-0095)", () => {
  it("the installed command guards the bin and blocks (exit 2) when missing", () => {
    expect(HOOK_COMMAND).toContain("command -v kj-trash");
    expect(HOOK_COMMAND).toContain("exit 2");
    expect(HOOK_COMMAND).toMatch(/DOWN/);
  });

  it("upgrades a legacy bare line in place — no duplicates, mutated:true", () => {
    const initial = {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: LEGACY_HOOK_COMMAND }] }] },
    };
    const { settings, mutated } = patchSettings(initial);
    expect(mutated).toBe(true);
    const bash = settings.hooks.PreToolUse.find((e) => e.matcher === "Bash");
    expect(bash.hooks).toHaveLength(1);
    expect(bash.hooks[0].command).toBe(HOOK_COMMAND);
  });

  it("an entry carrying BOTH legacy and new line ends with a single copy (reviewer catch)", () => {
    const initial = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: LEGACY_HOOK_COMMAND },
              { type: "command", command: HOOK_COMMAND },
            ],
          },
        ],
      },
    };
    const { settings } = patchSettings(initial);
    const bash = settings.hooks.PreToolUse.find((e) => e.matcher === "Bash");
    expect(bash.hooks.filter((h) => h.command === HOOK_COMMAND)).toHaveLength(1);
    expect(bash.hooks.some((h) => h.command === LEGACY_HOOK_COMMAND)).toBe(false);
  });

  it("behaves: blocks with the warning without the bin; delegates when present", () => {
    const empty = spawnSync("/bin/sh", ["-c", HOOK_COMMAND], { encoding: "utf8", env: { PATH: "/nonexistent" } });
    expect(empty.status).toBe(2);
    expect(empty.stderr).toContain("anti-delete net is DOWN");

    const binDir = mkdtempSync(join(tmpdir(), "kj-trash-bin-"));
    writeFileSync(join(binDir, "kj-trash"), "#!/bin/sh\necho delegated-ok\nexit 0\n", { mode: 0o755 });
    const ok = spawnSync("/bin/sh", ["-c", HOOK_COMMAND], {
      encoding: "utf8",
      env: { PATH: `${binDir}:/usr/bin:/bin` },
    });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("delegated-ok");
    rmSync(binDir, { recursive: true, force: true });
  });
});
