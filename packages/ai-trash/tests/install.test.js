// install --claude-code tests (KJC-TSK-0390 commit 3).
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { installClaudeCodeHook, patchSettings, HOOK_COMMAND } from "../src/install.js";

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
