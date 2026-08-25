/**
 * ai-trash safety net availability check (KJC-TSK-0391).
 * Surfaces a WARN in `kj doctor` when the `kj-trash` binary is missing,
 * since the PreToolUse hook cannot snapshot destructive ops without it.
 * The remediation is `kj-trash install --claude-code` once the binary is
 * on PATH (the workspace ships it with karajan-code).
 */

import { detectAiTrash } from "../utils/ai-trash.js";
import { STRATEGY } from "./types.js";

function createAiTrashCheck() {
  return {
    name: "ai-trash",
    label: "ai-trash safety net",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const res = await detectAiTrash();
      if (res.available) {
        return { ok: true, severity: "info", detail: "kj-trash present — preventive safety net active" };
      }
      return {
        ok: false,
        severity: "warn",
        detail: "kj-trash not found — destructive ops unprotected",
        fix: "Install karajan-code globally (npm i -g @karajan-family/code) so kj-trash is on PATH, then run `kj-trash install --claude-code`",
      };
    },
  };
}

export function getAiTrashChecks() {
  return [createAiTrashCheck()];
}
