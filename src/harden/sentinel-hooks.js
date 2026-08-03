/**
 * sentinel-hooks — SEN-A (KJC-TSK-0713, epic KJC-PCS-0071 Karajan Sentinel).
 * v3 had authority without intelligence; v4 intelligence without authority.
 * The Sentinel separates them: a deterministic PROGRAM (zero LLM) supervises
 * the agent through the harness's synchronous hooks — PostToolUse records
 * method facts per session, Stop BLOCKS ending the turn while violations are
 * open. Claude Code only: it is the one harness with synchronous blocking
 * hooks, which is why the guaranteed level requires Claude as host (ADR).
 * This module ships the state writer; the Stop gate lands next.
 */

import { mergeClaudeHooks, writeHarnessScript } from "./harness-hooks.js";

const POST_BODY = `#!/usr/bin/env node
// kj sentinel state writer (KJC-TSK-0713) — managed by \`kj harden\`.
// Records deterministic method facts per session; never blocks, never fails
// a tool call (PostToolUse, always exit 0).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const STATE = join(here, "sentinel-state.json");
const ROOT = join(here, "..", "..");
const TESTS = /(^|\\/)(tests?|__tests__|spec)\\/|\\.(test|spec)\\.[a-z]+$/;
const CODE = /\\.(m?[jt]sx?|c[jt]s|py|go|rs|java|rb|php|cs|swift|kt|astro|svelte|vue|c|h|cc|cpp|hpp)$/;
const ESCAPES = ["KJ_ALLOW_WRITE", "KJ_ALLOW_REWRITE", "KJ_ALLOW_NO_CARD", "KJ_ALLOW_NO_TESTS", "KJ_ALLOW_PII"];
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { session_id: sid = "default", tool_name: tool, tool_input: input = {} } = JSON.parse(raw);
    const file = input.file_path || input.notebook_path;
    if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool) || !file) process.exit(0);
    let state = {};
    try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch { /* fresh state */ }
    state.sessions ||= {};
    const s = (state.sessions[sid] ||= { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0 });
    s.at = Date.now();
    const rel = relative(ROOT, file).replaceAll("\\\\", "/");
    const bucket = TESTS.test(rel) ? s.edited_tests : CODE.test(rel) ? s.edited_sources : null;
    if (bucket && !bucket.includes(rel)) bucket.push(rel);
    for (const e of ESCAPES) if (process.env[e] === "1" && !s.escapes.includes(e)) s.escapes.push(e);
    const ids = Object.keys(state.sessions);
    if (ids.length > 5) delete state.sessions[ids.sort((a, b) => (state.sessions[a].at || 0) - (state.sessions[b].at || 0))[0]];
    writeFileSync(STATE, JSON.stringify(state, null, 2));
  } catch { /* fail open — the sentinel never breaks a tool call */ }
  process.exit(0);
});
`;


/** Write the state-writer script and wire PostToolUse into .claude/settings.json. */
export function installSentinelHooks({ projectDir = process.cwd(), logger = console } = {}) {
  const post = writeHarnessScript(projectDir, "posttooluse.mjs", POST_BODY);
  const { wired } = mergeClaudeHooks({
    projectDir,
    logger,
    entries: [{ event: "PostToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit", script: "posttooluse.mjs" }],
  });
  return { scripts: [post], wired };
}
