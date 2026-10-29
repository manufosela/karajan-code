// KJC-BUG-0161 / ADR 0009 — the committed hook must not bake a machine's
// absolute home path. HU-2762: nothing machine-specific is generated at all —
// the chain to the global hooks resolves when the hook runs.
import { describe, expect, it } from "vitest";

import { hookBody, PROFILE_HOOKS } from "../../src/harden/hook-templates.js";

describe("hook bodies are machine-portable (KJC-BUG-0161, HU-2762)", () => {
  it("no body bakes a home path or the literal homedir()", () => {
    for (const hook of PROFILE_HOOKS.standard) {
      const body = hookBody(hook, {}, { globalHooksDir: "/home/manu/.git-hooks" });
      expect(body).not.toContain("homedir()");
      expect(body).not.toContain("/home/manu");
    }
  });
});
