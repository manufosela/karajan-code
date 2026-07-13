/**
 * RAG post-merge hook wiring check (KJC-BUG-0100).
 *
 * `kj rag install-hooks` used to write the hook into `.git/hooks/post-merge`,
 * but when a repo is hardened `git config core.hooksPath` points at
 * `.karajan/hooks` and git ignores `.git/hooks/` entirely — so the RAG index
 * silently never refreshes after a merge. This check resolves the *effective*
 * hooks dir and reports whether the post-merge hook there reindexes the RAG.
 * The pre-run drift check in `kj run` already covers the gap, so a missing
 * hook is advisory (info), not a failure — it surfaces the state without
 * nagging every repo that never ran `kj rag install-hooks`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STRATEGY } from "./types.js";
import { resolveHooksDir } from "../rag/auto-update.js";

export function createRagHooksCheck({ projectDir } = {}) {
  return {
    name: "rag-hooks",
    label: "RAG post-merge refresh",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const dir = projectDir || process.cwd();
      let hooks;
      try {
        hooks = await resolveHooksDir(dir);
      } catch {
        return { ok: true, severity: "info", detail: "not a git repository — no post-merge hook to wire" };
      }
      const target = join(hooks.dir, "post-merge");
      const wired = existsSync(target) && /kj\s+rag\s+index/.test(readFileSync(target, "utf8"));
      if (wired) {
        return {
          ok: true,
          severity: "info",
          detail: `post-merge reindexes the RAG (${hooks.hooksPath || ".git/hooks"})`,
        };
      }
      const where = hooks.hooksPath ? ` — core.hooksPath=${hooks.hooksPath}` : "";
      return {
        ok: false,
        severity: "info",
        detail: `RAG index won't auto-refresh after merges${where}; pre-run drift check still covers \`kj run\``,
        fix: "Wire the post-merge hook: `kj rag install-hooks`",
      };
    },
  };
}

export function getRagHooksChecks({ projectDir } = {}) {
  return [createRagHooksCheck({ projectDir })];
}
