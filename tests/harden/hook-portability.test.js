// KJC-BUG-0161 / ADR 0009 — the committed hook must not bake a machine's
// absolute home path: the chain to the user's previous global hooks resolves
// through $HOME at runtime, so the SAME generated content is valid (and its
// provenance verifiable) on every machine — and no local filesystem layout
// leaks into a public repo.
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hookBody } from "../../src/harden/hook-templates.js";

describe("hook chaining is machine-portable (KJC-BUG-0161)", () => {
  it("a global hooks dir under the home resolves through $HOME, never the literal path", () => {
    const globalHooksDir = join(homedir(), ".git-hooks");
    for (const hook of ["pre-commit", "commit-msg", "pre-push", "post-merge"]) {
      const body = hookBody(hook, {}, { globalHooksDir });
      expect(body, `${hook} bakes the literal home path`).not.toContain(homedir());
      expect(body).toContain(`"$HOME/.git-hooks/${hook}"`);
    }
  });

  it("a global hooks dir OUTSIDE the home stays literal — there is nothing to normalize", () => {
    const body = hookBody("pre-commit", {}, { globalHooksDir: "/opt/git-hooks" });
    expect(body).toContain('"/opt/git-hooks/pre-commit"');
  });

  it("no global dir, no chain — unchanged behavior", () => {
    const body = hookBody("pre-commit", {}, {});
    expect(body).not.toContain(".git-hooks");
  });
});
