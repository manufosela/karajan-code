/**
 * sentinel-hooks — SEN-A (KJC-TSK-0713, epic KJC-PCS-0071 Karajan Sentinel).
 * v3 had authority without intelligence; v4 intelligence without authority.
 * The Sentinel separates them: a deterministic PROGRAM (zero LLM) supervises
 * the agent through the harness's synchronous hooks — PostToolUse records
 * method facts per session, Stop BLOCKS ending the turn while violations are
 * open. Claude Code only: it is the one harness with synchronous blocking
 * hooks, which is why the guaranteed level requires Claude as host (ADR).
 */

import { CARD_REF_RE } from "../review/card-first.js";
import { mergeClaudeHooks, writeHarnessScript } from "./harness-hooks.js";

const LIB_BODY = `// kj sentinel shared lib (KJC-TSK-0714) — managed by \`kj harden\`.
// Single source for every sentinel script: state, branch, classification,
// violations, and escape recording.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
export const STATE = join(here, "sentinel-state.json");
export const ROOT = join(here, "..", "..");
export const TESTS = /(^|\\/)(tests?|__tests__|spec)\\/|\\.(test|spec)\\.[a-z]+$/;
export const CODE = /\\.(m?[jt]sx?|c[jt]s|py|go|rs|java|rb|php|cs|swift|kt|astro|svelte|vue|c|h|cc|cpp|hpp)$/;
export const CARD = new RegExp(${JSON.stringify(CARD_REF_RE.source)}, "i");
export const BASE_BRANCHES = new Set(["main", "master"]);
export const load = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; } };
export const save = (state) => writeFileSync(STATE, JSON.stringify(state, null, 2));
export const session = (state, sid) => {
  state.sessions ||= {};
  return (state.sessions[sid] ||= { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0 });
};
export const branchOf = () => {
  try { return execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
};
export const violations = (s, branch) => {
  const v = [];
  if (!s || !(s.edited_sources || []).length) return v;
  if (BASE_BRANCHES.has(branch)) v.push("Fuentes editadas en la rama base '" + branch + "' — crea una rama: git checkout -b feat/<CARD-ID>-descripcion");
  else if (branch && !CARD.test(branch)) v.push("La rama '" + branch + "' no referencia ninguna card — usa feat/<CARD-ID>-descripcion (y una card VIVA en el board)");
  if (!(s.edited_tests || []).length) v.push("Fuentes editadas sin tocar un solo test (" + s.edited_sources.join(", ") + ") — escribe o actualiza el test que prueba el cambio");
  return v;
};
export const recordEscape = (sid, escape, tool) => {
  const state = load();
  const s = session(state, sid);
  s.at = Date.now();
  if (!s.escapes.includes(escape)) s.escapes.push(escape);
  (state.escape_events ||= []).push({ escape, tool, sid, ts: Date.now() });
  save(state);
};
`;

const POST_BODY = `#!/usr/bin/env node
// kj sentinel state writer (KJC-TSK-0713) — managed by \`kj harden\`.
// Records deterministic method facts per session; never blocks, never fails
// a tool call (PostToolUse, always exit 0).
import { relative } from "node:path";
import { CODE, TESTS, ROOT, load, save, session } from "./sentinel-lib.mjs";
const ESCAPES = ["KJ_ALLOW_WRITE", "KJ_ALLOW_REWRITE", "KJ_ALLOW_NO_CARD", "KJ_ALLOW_NO_TESTS", "KJ_ALLOW_PII"];
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { session_id: sid = "default", tool_name: tool, tool_input: input = {} } = JSON.parse(raw);
    const file = input.file_path || input.notebook_path;
    if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool) || !file) process.exit(0);
    const state = load();
    const s = session(state, sid);
    s.at = Date.now();
    const rel = relative(ROOT, file).replaceAll("\\\\", "/");
    const bucket = TESTS.test(rel) ? s.edited_tests : CODE.test(rel) ? s.edited_sources : null;
    if (bucket && !bucket.includes(rel)) bucket.push(rel);
    for (const e of ESCAPES) if (process.env[e] === "1" && !s.escapes.includes(e)) s.escapes.push(e);
    const ids = Object.keys(state.sessions);
    if (ids.length > 5) delete state.sessions[ids.sort((a, b) => (state.sessions[a].at || 0) - (state.sessions[b].at || 0))[0]];
    save(state);
  } catch { /* fail open — the sentinel never breaks a tool call */ }
  process.exit(0);
});
`;

const STOP_BODY = `#!/usr/bin/env node
// kj sentinel stop gate (KJC-TSK-0713) — managed by \`kj harden\`. Exit 2
// BLOCKS ending the turn while method violations are open (stderr lists each
// one with its remediation). Fails OPEN on corrupt state, git errors, or
// after 3 unresolved blocks — a sentinel bug never bricks the session — and
// the fail-open is recorded in the state. \`--status\` prints, never blocks.
import { load, save, branchOf, violations } from "./sentinel-lib.mjs";
if (process.argv.includes("--status")) {
  const st = load();
  const branch = branchOf();
  const sessions = Object.entries(st.sessions || {});
  if (!sessions.length) console.log("sentinel: sin actividad registrada en esta sesion");
  for (const [sid, s] of sessions) {
    console.log("session " + sid + ": sources=[" + (s.edited_sources || []).join(", ") + "] tests=[" + (s.edited_tests || []).join(", ") + "] escapes=[" + (s.escapes || []).join(", ") + "] blocks=" + (s.blocks || 0) + ((s.errors || []).length ? " errors=" + s.errors.length : ""));
    for (const x of violations(s, branch)) console.log("  ROJO: " + x);
  }
  process.exit(0);
}
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    if (process.env.KJ_SENTINEL_OFF === "1") process.exit(0);
    const { session_id: sid = "default" } = JSON.parse(raw);
    const state = load();
    const s = state.sessions?.[sid];
    if (!s) process.exit(0);
    const v = violations(s, branchOf());
    if (!v.length) {
      s.blocks = 0;
      save(state);
      process.exit(0);
    }
    s.blocks = (s.blocks || 0) + 1;
    if (s.blocks > 3) {
      (s.errors ||= []).push("fail-open: 3 bloqueos consecutivos sin resolver — el sentinel se aparta para no colgar la sesion");
      save(state);
      console.error("kj sentinel: fail-open tras 3 bloqueos sin resolver — revisa kj sentinel status con tu usuario");
      process.exit(0);
    }
    save(state);
    console.error("kj sentinel: el turno NO puede terminar con el metodo en rojo:\\n" + v.map((x) => "- " + x).join("\\n") + "\\nResuelve las violaciones (o pide a tu usuario el escape) y termina de nuevo. Estado: kj sentinel status");
    process.exit(2);
  } catch { /* fail open */ }
  process.exit(0);
});
`;

/** Write the sentinel scripts (shared lib + state writer + stop gate) and wire them. */
export function installSentinelHooks({ projectDir = process.cwd(), logger = console } = {}) {
  const lib = writeHarnessScript(projectDir, "sentinel-lib.mjs", LIB_BODY);
  const post = writeHarnessScript(projectDir, "posttooluse.mjs", POST_BODY);
  const stop = writeHarnessScript(projectDir, "stop.mjs", STOP_BODY);
  const { wired } = mergeClaudeHooks({
    projectDir,
    logger,
    entries: [
      { event: "PostToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit", script: "posttooluse.mjs" },
      { event: "Stop", script: "stop.mjs" },
    ],
  });
  return { scripts: [lib, post, stop], wired };
}
