/**
 * sentinel-hooks — SEN-A (KJC-TSK-0713, epic KJC-PCS-0071 Karajan Sentinel).
 * v3 had authority without intelligence; v4 intelligence without authority.
 * The Sentinel separates them: a deterministic PROGRAM (zero LLM) supervises
 * the agent through the harness's synchronous hooks — PostToolUse records
 * method facts per session, Stop BLOCKS ending the turn while violations are
 * open. Claude Code only: it is the one harness with synchronous blocking
 * hooks, which is why the guaranteed level requires Claude as host (ADR).
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { CARD_REF_RE } from "../review/card-first.js";
import { mergeClaudeHooks, writeHarnessScript } from "./harness-hooks.js";

/** The harness lives at the PROJECT root — resolve it even from a subdir. */
export function resolveSentinelRoot(dir = process.cwd()) {
  try {
    return (
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || dir
    );
  } catch {
    return dir;
  }
}

const LIB_BODY = `// kj sentinel shared lib (KJC-TSK-0714) — managed by \`kj harden\`.
// Single source for every sentinel script: state, branch, classification,
// violations, and escape recording.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
export const STATE = join(here, "sentinel-state.json");
export const ROOT = join(here, "..", "..");
// INF-A (KJC-TSK-0758): infra IS source — terraform/k8s/shell/Docker edits
// engage the method like app code; *_test.* files (terratest) are tests.
export const TESTS = /(^|\\/)(tests?|__tests__|spec)\\/|\\.(test|spec)\\.[a-z]+$|_test\\.[a-z]+$/;
export const CODE = /\\.(m?[jt]sx?|c[jt]s|py|go|rs|java|rb|php|cs|swift|kt|astro|svelte|vue|c|h|cc|cpp|hpp|tf|hcl|ya?ml|sh)$|(^|\\/)(Dockerfile|Makefile|Vagrantfile)$/;
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
const _git = (args, cwd) => {
  try { return execSync("git " + args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
};
let _home;
// MONO-0 (ADR 0002): lane identity = worktree toplevel; repo identity =
// git-common-dir. Same repo but another toplevel than OUR root => foreign
// lane (returns its toplevel); anything else => null.
export const foreignLane = (targetDir) => {
  const top = _git("rev-parse --show-toplevel", targetDir);
  if (!top) return null;
  _home ||= { top: _git("rev-parse --show-toplevel", ROOT), common: _git("rev-parse --path-format=absolute --git-common-dir", ROOT) };
  if (!_home.top || top === _home.top) return null;
  const common = _git("rev-parse --path-format=absolute --git-common-dir", targetDir);
  return common && common === _home.common ? top : null;
};
// KJC-TSK-0765 board-sync: cards merged in this session but not yet moved in
// the tracker. The method does not advance until the board is true.
export const pendingMoves = (s) => (s && Array.isArray(s.pending_moves) ? s.pending_moves : []);
export const pendingText = (p) => (p.card ? p.card : "card sin identificar") + " (PR #" + p.pr + ") mergeada sin mover en el tracker — muevela a To Validate / Fixed con sus commits (update_card del PG o kj hu move)";
export const violations = (s, branch) => {
  const v = pendingMoves(s).map(pendingText);
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
  // GOV-F (KJC-TSK-0768): el escape es una excepcion consciente — entra en el
  // decision log hash-encadenado (kj policy seal), no solo en este estado.
  // Best-effort CON aviso: fail-closed aqui encerraria la sesion justo cuando
  // kj no carga, que es cuando mas se usa el escape (restaurar con git).
  try {
    const args = ["policy", "seal", "--escape", escape];
    if (tool) args.push("--tool", String(tool));
    const r = spawnSync("kj", args, { cwd: ROOT, encoding: "utf8" });
    if (r.error || r.status !== 0) console.error("kj sentinel: escape " + escape + " usado pero NO sellado en el decision log (kj policy seal " + (r.error ? r.error.message : "exit " + r.status) + ") — revisa kj; el escape queda solo en sentinel-state.json");
  } catch (e) {
    console.error("kj sentinel: escape " + escape + " usado pero NO sellado en el decision log: " + e.message);
  }
};
`;

const POST_BODY = `#!/usr/bin/env node
// kj sentinel state writer (KJC-TSK-0713) — managed by \`kj harden\`.
// Records deterministic method facts per session; never blocks, never fails
// a tool call (PostToolUse, always exit 0).
import { relative } from "node:path";
import { spawnSync } from "node:child_process";
import { CODE, TESTS, ROOT, CARD, branchOf, load, save, session } from "./sentinel-lib.mjs";
const ESCAPES = ["KJ_ALLOW_WRITE", "KJ_ALLOW_REWRITE", "KJ_ALLOW_NO_CARD", "KJ_ALLOW_NO_TESTS", "KJ_ALLOW_PII", "KJ_ALLOW_POLICY", "KJ_ALLOW_IDENTITY", "KJ_ALLOW_BOARD"];
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { session_id: sid = "default", tool_name: tool, tool_input: input = {}, tool_response: response = {} } = JSON.parse(raw);
    // KJC-TSK-0765 board-sync: a merge that gh CONFIRMS leaves its card pending
    // in the tracker (the PreToolUse gate then refuses to advance until it is
    // moved). Recorded here, after the fact, so a failed merge never blocks.
    const text = typeof response === "string" ? response : JSON.stringify(response);
    // Closing states that count as "registered in the tracker" (PG statuses and
    // HU Board moves). The pending entry is cleared by the REAL tool call that
    // moved the card — never by a promise in the agent's prose.
    const CLOSING = ["to validate", "to-validate", "fixed", "verified", "closed", "done", "done&validated", "validated"];
    const clearPending = (cardId) => {
      const state = load();
      const s = session(state, sid);
      const before = (s.pending_moves || []).length;
      s.pending_moves = (s.pending_moves || []).filter((p) => p.card !== null && p.card !== cardId);
      if (s.pending_moves.length !== before) save(state);
    };
    if (/__update_card$/.test(String(tool)) && /^mcp__/.test(String(tool))) {
      // The MCP response reaches the hook as {content:[{text:"<json>"}]}: once
      // stringified, the inner quotes are ESCAPED — match both forms (found live:
      // the first real update_card did not clear its pending entry).
      const cid = /\\\\?"cardId\\\\?"\\s*:\\s*\\\\?"([A-Za-z0-9-]+)\\\\?"/.exec(text);
      const st = /\\\\?"status\\\\?"\\s*:\\s*\\\\?"([^"\\\\]+)\\\\?"/.exec(text);
      if (cid && st && CLOSING.includes(st[1].toLowerCase())) clearPending(cid[1].toUpperCase());
      process.exit(0);
    }
    if (tool === "Bash") {
      const cmdText = String(input.command || "");
      // gh prints "merged pull request #N" only on a TTY: under a tool call the
      // success line is ABSENT (found live on the first dogfood merge). The
      // authoritative signal is the PR state itself: one gh pr view per merge.
      const mergeCmd = /\\bgh\\s+pr\\s+merge(\\s+(\\d+))?/.exec(cmdText);
      const said = /merged pull request #(\\d+)/i.exec(text);
      let mergedPr = said ? Number(said[1]) : null;
      // KJC-BUG-0148: the card belongs to the PR's HEAD branch, not to whatever
      // branch the working tree happens to be on (found live: a merge issued
      // from another card's lane pinned the pending move on the wrong card).
      let headRef = null;
      if (mergeCmd || said) {
        const n = said ? said[1] : mergeCmd[2];
        const args = ["pr", "view", ...(n ? [n] : []), "--json", "number,state,headRefName"];
        const r = spawnSync("gh", args, { cwd: ROOT, encoding: "utf8" });
        try {
          const v = JSON.parse(r.status === 0 ? r.stdout : "null");
          if (v && v.state === "MERGED") { mergedPr = Number(v.number); headRef = v.headRefName || null; }
        } catch { /* unknown = not confirmed (or confirmed only by the printed line) */ }
      }
      if (mergedPr !== null) {
        const state = load();
        const s = session(state, sid);
        const ref = CARD.exec(headRef || branchOf() || "");
        (s.pending_moves ||= []).push({ card: ref ? ref[0].toUpperCase() : null, pr: mergedPr, at: Date.now(), ...(headRef ? {} : { head: "unknown" }) });
        save(state);
      }
      const moved = /kj\\s+hu\\s+move\\s+([A-Za-z0-9-]+)\\s+([a-z&-]+)/i.exec(String(input.command || ""));
      if (moved && CLOSING.includes(moved[2].toLowerCase()) && !/error|fail/i.test(text)) clearPending(moved[1].toUpperCase());
      process.exit(0);
    }
    const file = input.file_path || input.notebook_path;
    if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool) || !file) process.exit(0);
    const state = load();
    const s = session(state, sid);
    s.at = Date.now();
    const rel = relative(ROOT, file).replaceAll("\\\\", "/");
    const bucket = TESTS.test(rel) ? s.edited_tests : CODE.test(rel) ? s.edited_sources : null;
    if (bucket && !bucket.includes(rel)) bucket.push(rel);
    for (const e of ESCAPES)
      if (process.env[e] === "1" && !s.escapes.includes(e)) {
        s.escapes.push(e);
        (state.escape_events ||= []).push({ escape: e, tool, sid, ts: Date.now() });
      }
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
import { spawnSync } from "node:child_process";
import { load, save, branchOf, violations, ROOT } from "./sentinel-lib.mjs";
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
    // Tamper check runs regardless of session state: shell indirection leaves
    // no edit-tool record, but it cannot survive \`kj sentinel verify\`, whose
    // root of trust is the INSTALLED kj package (outside this project tree) —
    // nothing under .karajan can vouch for itself. No kj on PATH → fail open.
    const ver = spawnSync("kj", ["sentinel", "verify", "--json"], { cwd: ROOT, encoding: "utf8" });
    let tampered = [];
    if (!ver.error && ver.status !== null && ver.status !== 0) {
      try { tampered = JSON.parse(ver.stdout).mismatched || ["unknown"]; } catch { tampered = ["unknown"]; }
    }
    if (tampered.length) {
      state.tamper_blocks = (state.tamper_blocks || 0) + 1;
      save(state);
      if (state.tamper_blocks > 3) {
        console.error("kj sentinel: fail-open tras 3 bloqueos por manipulacion sin restaurar — corre kj harden y avisa a tu usuario");
        process.exit(0);
      }
      console.error("kj sentinel: scripts del supervisor modificados fuera de kj harden (" + tampered.join(", ") + ") — restaura con kj harden antes de terminar; si lo cambiaste tu (humano), reinstalar lo deja en verde.");
      process.exit(2);
    }
    state.tamper_blocks = 0;
    const s = state.sessions?.[sid];
    if (!s) process.exit(0);
    const v = violations(s, branchOf());
    if (!v.length) {
      s.blocks = 0;
      save(state);
      if ((s.escapes || []).length)
        console.log(JSON.stringify({ systemMessage: "kj sentinel: esta sesion uso " + s.escapes.length + " escape(s): " + s.escapes.join(", ") + " — decision registrada; detalle en kj sentinel status." }));
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

const PRETOOL_BODY = `#!/usr/bin/env node
// kj sentinel pretooluse gate (KJC-TSK-0714) — managed by \`kj harden\`.
// Consults the session method state BEFORE the tool runs: the rule fires
// before the damage, not in the post-mortem. Exit 2 blocks (stderr says the
// remediation); read-only tools are never wired here; every honored escape
// is recorded as an auditable event. Fails OPEN on anything unexpected.
import { dirname, join, relative, resolve } from "node:path";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { CODE, TESTS, ROOT, BASE_BRANCHES, CARD, branchOf, foreignLane, load, violations, recordEscape, pendingMoves, pendingText } from "./sentinel-lib.mjs";
const EDIT_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const PUBLISH = /\\bnpm\\s+publish\\b|\\bfirebase\\s+deploy\\b|\\bgh\\s+release\\s+create\\b/;
const PUSH = /\\bgit\\s+push\\b/;
const PROTECTED = /\\.claude\\/settings\\.json\\b|\\.karajan\\/(hooks|harness)\\//;
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { session_id: sid = "default", tool_name: tool, tool_input: input = {} } = JSON.parse(raw);
    // Self-protection (KJC-TSK-0715) rules run BEFORE any escape, including
    // KJ_SENTINEL_OFF: the sentinel is not dismantled from inside a session —
    // only the human, editing outside it.
    if (EDIT_TOOLS.includes(tool)) {
      const target = input.file_path || input.notebook_path;
      const relT = target ? relative(ROOT, String(target)).replaceAll("\\\\", "/") : "";
      if (relT && PROTECTED.test(relT)) {
        console.error("kj sentinel: ese fichero es parte del supervisor (" + relT + ") — solo el humano desmonta el sentinel, editalo fuera de la sesion.");
        process.exit(2);
      }
    }
    // Any Bash that NAMES the supervisor's files is denied — a write-verb
    // blocklist is bypassable (cp, dd, one-liners), and reading them is what
    // the Read/Grep tools are for. Shell indirection (variables, globs,
    // substitution) cannot be resolved from command text: that vector is
    // caught by the Stop gate's checksum verification, which blocks the turn.
    if (tool === "Bash" && PROTECTED.test(String(input.command || "").replaceAll("\\\\", "/"))) {
      console.error("kj sentinel: los ficheros del supervisor no se tocan desde Bash — consultalos con la tool Read/Grep; solo el humano los modifica, fuera de la sesion.");
      process.exit(2);
    }
    if (process.env.KJ_SENTINEL_OFF === "1") process.exit(0);
    // KJC-BUG-0142: cada deny anuncia su escape como prefijo del comando
    // (KJ_ALLOW_X=1 cmd), pero el hook corre con el env del HOST — el
    // prefijo jamas llegaba a process.env y el escape era inalcanzable
    // (deadlock real del gate de release: la landing solo se pone verde
    // tras el deploy y el deploy estaba bloqueado por el mismo gate). Un
    // escape es una excepcion CONSCIENTE y auditada, no un boundary de
    // seguridad (security sigue sin escape y la autoprotecion corre antes),
    // asi que el TEXTO del comando es fuente valida: solo asignaciones
    // LITERALES al inicio (tokens VAR=VAL antes del primer verbo) y solo
    // sobre un comando SIMPLE — con ;|& $() backtick o salto de linea el
    // prefijo shell no alcanzaria a los comandos posteriores (catch de
    // codex: "X=1 true && npm publish" escaparia sin serlo), asi que el
    // escape por texto se rechaza y queda la via env de siempre.
    const CMD_TEXT = tool === "Bash" ? String(input.command || "") : "";
    const ESC_TAB = String.fromCharCode(9);
    const ESC_NL = String.fromCharCode(10);
    const ESC_BT = String.fromCharCode(96);
    const escOn = (name) => {
      if (process.env[name] === "1") return true;
      let found = false;
      let i = 0;
      while (i < CMD_TEXT.length) {
        while (i < CMD_TEXT.length && (CMD_TEXT[i] === " " || CMD_TEXT[i] === ESC_TAB)) i += 1;
        const start = i;
        while (i < CMD_TEXT.length && CMD_TEXT[i] !== " " && CMD_TEXT[i] !== ESC_TAB && CMD_TEXT[i] !== ESC_NL) i += 1;
        const tok = CMD_TEXT.slice(start, i);
        const eq = tok.indexOf("=");
        if (eq <= 0 || !/^[A-Z][A-Z0-9_]*$/.test(tok.slice(0, eq))) break;
        if (tok === name + "=1") found = true;
      }
      if (!found) return false;
      // KJC-BUG-0147: lo que va ENTRE COMILLAS no encadena comandos — un
      // mensaje "fix(x): ... (KJC-TSK-1)" es un comando simple. Dentro de
      // comillas dobles $ y backtick siguen expandiendo (se rechazan); en
      // comillas simples todo es literal. Y si el escape esta pero se ignora,
      // SE DICE: un escape ignorado en silencio era el bug.
      const bad = escSimple();
      if (bad === null) return true;
      if (!escNoted.has(name)) {
        escNoted.add(name);
        console.error("kj sentinel: " + name + "=1 presente pero IGNORADO — el escape solo vale en un comando simple y este contiene " + JSON.stringify(bad) + " fuera de comillas simples (sin ; | & $ ( ) backtick ni salto de linea: parte el comando o usa -F fichero)");
      }
      return false;
    };
    const escNoted = new Set();
    const escSimple = () => {
      let q = null;
      for (let i = 0; i < CMD_TEXT.length; i += 1) {
        const c = CMD_TEXT[i];
        if (q === "'") { if (c === "'") q = null; continue; }
        if (q === '"') {
          if (c === '"') q = null;
          else if (c === "$" || c === ESC_BT) return c;
          else if (c === "\\\\") i += 1;
          continue;
        }
        if (c === "\\\\") { i += 1; continue; }
        if (c === "'" || c === '"') { q = c; continue; }
        if (c === ";" || c === "|" || c === "&" || c === ESC_NL || c === ESC_BT || c === "$" || c === "(" || c === ")") return c;
      }
      return q === null ? null : "comilla sin cerrar";
    };
    // IDN-B (KJC-TSK-0763, ADR 0005): identity lock — gh and mutating git never
    // run under an account other than the one THIS CLONE declared (the incident:
    // a gh comment without switch went out as the client account). Deny BEFORE
    // the damage with the literal remedy; never auto-switch; undeclared = closed.
    if (tool === "Bash" && CMD_TEXT.length > 0) {
      const idFile = join(ROOT, ".karajan", "identity.local.yml");
      const idLine = (key) => {
        if (!existsSync(idFile)) return null;
        const line = readFileSync(idFile, "utf8").split(ESC_NL).find((l) => l.startsWith(key + ":"));
        const v = line ? line.slice(key.length + 1).trim() : "";
        return v.length > 0 ? v : null;
      };
      const declaredGh = idLine("gh_user");
      const declaredEmail = idLine("git_email");
      const ghHostsPath = join(process.env.GH_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gh"), "hosts.yml");
      const activeGh = () => {
        if (!existsSync(ghHostsPath)) return null;
        const lines = readFileSync(ghHostsPath, "utf8").split(ESC_NL);
        const start = lines.findIndex((l) => l.startsWith("github.com:"));
        if (start < 0) return null;
        for (let k = start + 1; k < lines.length; k += 1) {
          if (lines[k].length > 0 && lines[k][0] !== " " && lines[k][0] !== ESC_TAB) break;
          const t = lines[k].trim();
          if (t.startsWith("user:")) { const u = t.slice(5).trim(); return u.length > 0 ? u : null; }
        }
        return null;
      };
      const words = (seg) => seg.trim().split(" ").filter((w) => w.length > 0 && w !== ESC_TAB);
      const headOf = (ws) => { let k = 0; while (k < ws.length && ws[k].indexOf("=") > 0 && ws[k].indexOf("=") < ws[k].length) k += 1; return ws.slice(k); };
      // Wrapper shells hide the payload in a string (review catch): scan inside.
      const WRAPPERS =["sh", "bash", "zsh", "dash", "eval", "env", "xargs", "sudo", "nohup", "time", "exec"];
      let switchedTo = null;
      const problems = [];
      // $( and backticks are separators too (review catch): their payload is its own segment.
      const SEPS = [";", "&&", "||", "|", "$(", String.fromCharCode(96), "(", ")"];
      const bare = (w) => w.replaceAll(String.fromCharCode(39), "").replaceAll(String.fromCharCode(34), "");
      const scan = (text, depth) => { if (depth > 3) return; for (const seg of SEPS.reduce((acc, s) => acc.flatMap((l) => l.split(s)), text.split(ESC_NL))) checkSeg(headOf(words(seg)), depth, words(seg)); };
      const checkSeg = (ws, depth, raw) => {
        if (ws.length === 0) return;
        if (WRAPPERS.includes(ws[0])) { // wrapper args have arity (sudo -u bob): scan from the first gh/git/wrapper token (review catch)
          const j = ws.findIndex((w, i) => i > 0 && ["gh", "git", ...WRAPPERS].includes(bare(w)));
          if (j > 0) scan(ws.slice(j).map(bare).join(" "), depth + 1);
          return;
        }
        if (ws[0] === "gh") {
          if (ws[1] === "auth") {
            if (ws[2] === "switch") { const u = ws.indexOf("--user"); if (u > 0 && ws[u + 1]) switchedTo = ws[u + 1]; }
            return; // session commands ARE the remedy — never blocked
          }
          if (!declaredGh) { problems.push("gh without a declared identity for this clone — run: kj identity set"); return; }
          const eff = switchedTo || activeGh();
          if (eff !== declaredGh) problems.push("gh as '" + (eff || "no session") + "' but this clone is declared as '" + declaredGh + "' — prefix the command: gh auth switch --user " + declaredGh + " && ...");
          return;
        }
        if (ws[0] === "git") {
          // Global options (-C, -c, --git-dir, --work-tree...) are NOT re-implemented: they
          // are forwarded verbatim to git var, so git resolves identity exactly as the real
          // command would (review catches: -C cumulative, --git-dir, --opt=value forms).
          const TWO = ["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--exec-path", "--config-env"];
          let k = 1;
          while (k < ws.length && ws[k].startsWith("-")) k += TWO.includes(ws[k]) && ws[k + 1] ? 2 : 1;
          const globals = ws.slice(1, k).map(bare);
          const sub = ws[k];
          if (sub === "push") { // push authenticates with the gh session, not user.email (review catch)
            if (!declaredGh) { problems.push("git push without a declared identity for this clone — run: kj identity set"); return; }
            const eff = switchedTo || activeGh();
            if (eff !== declaredGh) problems.push("git push with gh session '" + (eff || "no session") + "' but this clone is declared as '" + declaredGh + "' — prefix: gh auth switch --user " + declaredGh + " && ...");
            return;
          }
          // IDN-B2: anything that authors or rewrites commits carries an identity (review catch).
          if (!["commit", "tag", "merge", "rebase", "cherry-pick", "am", "revert"].includes(sub)) return; // am: the COMMITTER is still this user
          if (!declaredEmail) { problems.push("git " + sub + " without a declared identity for this clone — run: kj identity set"); return; }
          // Let GIT resolve author and committer under the command's own environment
          // (review catch: user.email, -c, GIT_*_EMAIL, EMAIL, GIT_CONFIG_*, includeIf are
          // its business): git var is the single source of truth.
          const assigns = raw.slice(0, raw.length - ws.length).filter((w) => w.indexOf("=") > 0);
          const env = Object.assign({}, process.env);
          for (const w of assigns) env[w.slice(0, w.indexOf("="))] = bare(w.slice(w.indexOf("=") + 1));
          const ident = (v) => {
            const r = spawnSync("git", [...globals, "var", v], { cwd: ROOT, encoding: "utf8", env });
            const s = r.status === 0 ? String(r.stdout) : "";
            const a = s.indexOf("<");
            const b = s.indexOf(">");
            return a >= 0 && b > a ? s.slice(a + 1, b) : null;
          };
          const ai = ws.findIndex((w) => w.startsWith("--author"));
          const authorRaw = ai < 0 ? null : ws[ai].includes("=") ? ws[ai].slice(ws[ai].indexOf("=") + 1) : ws.slice(ai + 1).join(" ");
          const authorMail = authorRaw === null ? null : bare(authorRaw.includes("<") ? authorRaw.slice(authorRaw.indexOf("<") + 1, authorRaw.indexOf(">")) : authorRaw.trim());
          const mails = [authorMail ?? ident("GIT_AUTHOR_IDENT"), ident("GIT_COMMITTER_IDENT")]; // --author overrides the author (review catch); the committer is always git's
          const offender = mails.find((m) => m !== null && m !== declaredEmail) ?? (mails[0] === null ? "none" : null);
          if (offender !== null) problems.push("git " + sub + " as '" + offender + "' but this clone is declared as '" + declaredEmail + "' — use: git -c user.email=" + declaredEmail + " " + sub + " ... (or git config user.email " + declaredEmail + ")");
        }
      };
      scan(CMD_TEXT, 0);
      if (problems.length > 0) {
        if (escOn("KJ_ALLOW_IDENTITY")) { recordEscape(sid, "KJ_ALLOW_IDENTITY", tool); }
        else {
          console.error("kj sentinel: identity lock (ADR 0005) —" + problems.map((p) => ESC_NL + "- " + p).join("") + ESC_NL + "(KJ_ALLOW_IDENTITY=1 = excepcion consciente, queda registrada)");
          process.exit(2);
        }
      }
    }
    // MONO-0 (KJC-TSK-0737, ADR 0002): cada sesion muta solo SU worktree;
    // otro carril del MISMO repo se deniega ANTES del dano. Lectura libre.
    const laneOf = (p) => {
      // Sube al primer ancestro EXISTENTE (un subdir aun no creado escapaba).
      let d = String(p);
      if (!(existsSync(d) && statSync(d).isDirectory())) d = dirname(d);
      while (d && !existsSync(d)) {
        const up = dirname(d);
        if (up === d) return null;
        d = up;
      }
      // Canonicaliza (reviewer catch: un symlink local hacia otro carril
      // esquivaba la clasificacion por ruta literal).
      try { d = realpathSync(d); } catch { /* se clasifica tal cual */ }
      return d ? foreignLane(d) : null;
    };
    const laneDeny = (what, lane) => {
      if (escOn("KJ_ALLOW_CROSS_LANE")) { recordEscape(sid, "KJ_ALLOW_CROSS_LANE", tool); return false; }
      console.error("kj sentinel: " + what + " vive en otro carril (" + lane + ") de este repo — cada sesion muta solo SU worktree (MONO-0). Cruce deliberado: KJ_ALLOW_CROSS_LANE=1, queda registrado.");
      return true;
    };
    if (EDIT_TOOLS.includes(tool)) {
      const target = input.file_path || input.notebook_path;
      const lane = target ? laneOf(target) : null;
      if (lane && laneDeny(String(target), lane)) process.exit(2);
    }
    if (tool === "Bash") {
      const cmd = String(input.command || "");
      // Deny-unless-known-read-only: un allowlist de verbos mutadores era
      // esquivable (dd, interpretes). Solo un comando SIMPLE de lectura (sin
      // encadenar ni redirigir) puede nombrar otro carril; leer carriles es
      // trabajo de las tools Read/Grep, como con los ficheros del supervisor.
      // Solo LITERALES: expansión/sustitución en un comando "de lectura"
      // puede ejecutar cualquier cosa (reviewer catch: grep foo $(rm ...)).
      // (find fuera: -delete/-exec mutan — reviewer catch; sus tokens de
      // carril los caza el escaner de abajo.)
      const READONLY = /^[ \\t]*(grep|rg|cat|head|tail|less|ls|wc|diff|stat|file|du|tree|git (log|show|diff|status|blame))\\b[^;|&<>$\`(){}\\n\\r]*$/;
      if (!READONLY.test(cmd)) {
        // cd/pushd invalida TODO razonamiento textual de rutas posteriores
        // (carrera de bypasses confirmada en review: destino bare, con $,
        // relativas post-cd...): en un comando NO-read-only, cambiar de
        // directorio se deniega conservadoramente — el remedio es no
        // necesitarlo (git -C, npm --prefix, rutas absolutas).
        if (/(^|[;&|(\\s])(cd|pushd)([ \\t]|$)/.test(cmd)) {
          if (escOn("KJ_ALLOW_CROSS_LANE")) { recordEscape(sid, "KJ_ALLOW_CROSS_LANE", tool); }
          else {
            console.error("kj sentinel: cd/pushd en un comando mutador — las rutas posteriores no son verificables por el guard de carriles (MONO-0); usa git -C / npm --prefix / rutas ABSOLUTAS sin cd (o KJ_ALLOW_CROSS_LANE=1, queda registrado).");
            process.exit(2);
          }
        }
        // Absolute AND dot-relative tokens (../lane escapaba al primer scan —
        // reviewer catch); relative se resuelve contra el cwd de la sesion.
        // EVERY token (un tope seria un bypass); dedup acota el coste git.
        // Fallo de solomon (seguridad no arbitrable) + carrera de bypasses:
        // la expansion ($, backtick) solo se tolera en segmentos que son
        // asignaciones puras o runners del toolchain propio (npm/pnpm/yarn/
        // vitest/jest/kj/gh/echo/printf, git sin -C/--git-dir/--work-tree) —
        // sus argumentos son datos. En herramientas genericas de fichero o
        // interpretes el objetivo queda oculto al texto => deny. Los paths
        // LITERALES (tambien dentro de sustituciones) los escanea el bucle
        // de tokens de abajo; el residuo (expansion anidada en segmentos
        // runner) queda documentado como en la regla de ficheros PROTECTED.
        if (/>{1,2}[ \\t]*["']?[\\$\`]/.test(cmd)) {
          if (escOn("KJ_ALLOW_CROSS_LANE")) { recordEscape(sid, "KJ_ALLOW_CROSS_LANE", tool); }
          else {
            console.error("kj sentinel: redireccion con destino tras variable/sustitucion — el guard de carriles no puede verificarlo (MONO-0); usa una ruta LITERAL (o KJ_ALLOW_CROSS_LANE=1, queda registrado).");
            process.exit(2);
          }
        }
        // Sustitucion de comandos ($(...) o backticks) EJECUTA su contenido
        // en cualquier posicion, y una ruta entrecomillada con espacios es
        // invisible al tokenizador: ambas => deny conservador (endpoint
        // pedido por el reviewer; friccion asumida, el remedio es literal).
        // KJC-BUG-0140: pares de comillas REALES, no regex sobre el texto —
        // la comilla de CIERRE de un string + un redirect literal + la de
        // apertura del siguiente creaban la ilusion de ruta con espacios y
        // denegaban el flujo estandar commit -m "..." > log && echo "ok".
        // Se recorre alternando estado (doctrina del parseCommand del motor):
        // solo el CONTENIDO realmente entrecomillado con slash y espacio
        // deniega — incluidas comillas a mitad de token (scp host:"/a b/x")
        // y la comilla sin cerrar (no verificable).
        // ...y por TOKEN completo, no por span: spans adyacentes concatenan
        // ("dir with"" spaces/file" es UNA ruta) — catch de codex.
        const quotedPathWithSpaces = (s) => {
          // Un backslash pegado a comilla o blanco (comilla escapada,
          // espacio escapado) altera donde CIERRA el string o esconde
          // espacios: opaco => deny (doctrina del motor) — catch de codex.
          // Caracteres construidos con fromCharCode: CERO escaping en este
          // template — fuente y artefacto identicos, nada que malinterpretar
          // (el doble-escaping confundio cuatro reviews; solomon desestimo
          // la primera y las demas se volvieron ilegibles igual).
          // El punto escapado de un sed y similares siguen libres.
          const BS = String.fromCharCode(92);
          const TAB = String.fromCharCode(9);
          const NL = String.fromCharCode(10);
          for (let i = s.indexOf(BS); i !== -1; i = s.indexOf(BS, i + 1)) {
            const n = s[i + 1] || "";
            if (n === '"' || n === "'" || n === " " || n === TAB) return true;
          }
          let q = null;
          let tok = "";
          let hadQuote = false;
          const flush = () => {
            const bad = hadQuote && tok.includes("/") && tok.includes(" ");
            tok = "";
            hadQuote = false;
            return bad;
          };
          for (const ch of s) {
            if (q) {
              if (ch === q) q = null;
              else tok += ch;
              continue;
            }
            if (ch === '"' || ch === "'") {
              q = ch;
              hadQuote = true;
              continue;
            }
            if (ch === " " || ch === TAB || ch === NL || ch === ";" || ch === "|" || ch === "&" || ch === "<" || ch === ">" || ch === "(" || ch === ")") {
              if (flush()) return true;
              continue;
            }
            tok += ch;
          }
          if (q !== null) return true; // comilla sin cerrar: no verificable
          return flush();
        };
        if (/\\$\\(|\`/.test(cmd) || quotedPathWithSpaces(cmd)) {
          if (escOn("KJ_ALLOW_CROSS_LANE")) { recordEscape(sid, "KJ_ALLOW_CROSS_LANE", tool); }
          else {
            console.error("kj sentinel: sustitucion de comandos o ruta entrecomillada con espacios en un comando mutador — no verificable por el guard de carriles (MONO-0); usa valores/rutas LITERALES sin sustitucion (o KJ_ALLOW_CROSS_LANE=1, queda registrado).");
            process.exit(2);
          }
        }
        const SAFE_EXP_SEG = /^([A-Za-z_][A-Za-z0-9_]*=[^ \\t]*[ \\t]*)*((npm|pnpm|yarn|vitest|jest|kj|gh|echo|printf|true|test)\\b|git[ \\t](?![^\\n]*(-C[ \\t]|--git-dir|--work-tree)))[^;|&\\n]*$|^[A-Za-z_][A-Za-z0-9_]*=[^;|&\\n]*$/;
        const segs = cmd.split(/&&|\\|\\||[;|\\n]/).map((s) => s.trim()).filter(Boolean);
        if (!segs.every((s) => !/[\\$]/.test(s) || SAFE_EXP_SEG.test(s))) {
          if (escOn("KJ_ALLOW_CROSS_LANE")) { recordEscape(sid, "KJ_ALLOW_CROSS_LANE", tool); }
          else {
            console.error("kj sentinel: expansion de shell en una herramienta generica de fichero/interprete — el objetivo no es verificable por el guard de carriles (MONO-0); usa rutas LITERALES o un runner del toolchain (o KJ_ALLOW_CROSS_LANE=1, queda registrado).");
            process.exit(2);
          }
        }
        // ...incluidas relativas A PELO (los carriles kj viven en
        // .kj/worktrees/). Un falso token (s/a/b/) resuelve al arbol propio
        // y foreignLane da null — solo deniega lo que CAE en otro carril.
        const seen = new Set();
        for (const m of cmd.matchAll(/(?:^|[\\s"'=;(><])((?:\\.\\.?\\/)[^\\s"'\`;|&)]*|\\/[^\\s"'\`;|&)]+|~\\/[^\\s"'\`;|&)]+|[A-Za-z0-9_.@-]+\\/[^\\s"'\`;|&)]+)/g)) {
          const t = m[1].startsWith("~/") ? (process.env.HOME || "~") + m[1].slice(1) : m[1];
          const abs = resolve(t);
          if (seen.has(abs)) continue;
          seen.add(abs);
          const lane = laneOf(abs);
          if (lane && laneDeny(m[1], lane)) process.exit(2);
        }
      }
    }
    // KJC-TSK-0734 (PL-B): con .karajan/policy.yml presente, la evaluacion
    // la hace el MOTOR via kj policy eval --strict (exit 2 = deny, contrato
    // PL-A); los defaults del supervisor viven en el motor y el check
    // PROTECTED inline de arriba queda como red fail-closed si kj falta.
    // Fail CLOSED por defecto (catches de codex; doctrina KJC-BUG-0095: un
    // gate no se cae en silencio): solo exit 0 permite. kj inejecutable =
    // deny duro (el remedio es restaurar kj); cualquier otro fallo de
    // evaluacion = deny con escape humano registrable — la sesion no queda
    // presa de un typo de YAML, pero abrirla es decision del usuario.
    if ((EDIT_TOOLS.includes(tool) || tool === "Bash") && existsSync(resolve(ROOT, ".karajan", "policy.yml"))) {
      // PL-C: el rol que ACTÚA (KJ_POLICY_ROLE, sembrado por los runners de
      // kj run en los subprocesos) — el anfitrión-brain evalúa como coder.
      const actorRole = process.env.KJ_POLICY_ROLE || "coder";
      const pres = spawnSync("kj", ["policy", "eval", "--strict", "--role", actorRole, "--tool", tool, "--input", JSON.stringify(input)], { cwd: ROOT, encoding: "utf8" });
      if (pres.error || pres.status === null) {
        console.error("kj sentinel: .karajan/policy.yml declara enforcement pero kj no es ejecutable — la policy no se puede evaluar; restaura kj en el PATH (npm i -g @karajan-family/code, o el nombre legacy karajan-code) o retira la policy conscientemente.");
        process.exit(2);
      }
      if (pres.status === 2) {
        let v = null;
        try { v = JSON.parse(String(pres.stdout || "").trim().split("\\n").pop()); } catch { /* mensaje generico */ }
        const secure = !!(v && v.class === "security");
        if (!secure && escOn("KJ_ALLOW_POLICY")) { recordEscape(sid, "KJ_ALLOW_POLICY", tool); }
        else {
          console.error("kj sentinel: policy deny [" + ((v && v.rule_id) || "policy") + "] " + ((v && v.reason) || "la tool call viola la policy del proyecto") + (secure ? " [security — sin escape ni arbitraje]" : " (KJ_ALLOW_POLICY=1 = excepcion consciente, queda registrada; el commit exigira ademas KJ_POLICY_REASON)"));
          process.exit(2);
        }
      } else if (pres.status !== 0) {
        if (escOn("KJ_ALLOW_POLICY")) { recordEscape(sid, "KJ_ALLOW_POLICY", tool); }
        else {
          console.error("kj sentinel: kj policy eval fallo (exit " + pres.status + ") — la policy declarada no se pudo evaluar, deny por defecto; diagnostica con kj policy check y corrige .karajan/policy.yml fuera de la sesion (o KJ_ALLOW_POLICY=1 = excepcion consciente, queda registrada).");
          process.exit(2);
        }
      }
    }
    if (EDIT_TOOLS.includes(tool)) {
      const file = input.file_path || input.notebook_path;
      const rel = file ? relative(ROOT, String(file)).replaceAll("\\\\", "/") : "";
      if (rel && CODE.test(rel) && !TESTS.test(rel)) {
        const branch = branchOf();
        const why = !branch ? null : BASE_BRANCHES.has(branch) ? "base" : !CARD.test(branch) ? "nocard" : null;
        if (why) {
          if (escOn("KJ_ALLOW_NO_CARD")) { recordEscape(sid, "KJ_ALLOW_NO_CARD", tool); process.exit(0); }
          console.error(why === "base"
            ? "kj sentinel: no se editan fuentes en la rama base '" + branch + "' — crea la card (kj hu add) y la rama: git checkout -b feat/<CARD-ID>-descripcion. (KJ_ALLOW_NO_CARD=1 = excepcion consciente, queda registrada)"
            : "kj sentinel: la rama '" + branch + "' no referencia ninguna card — crea/mueve la card a running (kj hu add | kj hu move) y usa una rama feat/<CARD-ID>-descripcion. (KJ_ALLOW_NO_CARD=1 = excepcion consciente, queda registrada)");
          process.exit(2);
        }
      }
    }
    if (tool === "Bash") {
      const cmd = String(input.command || "");
      // KJC-TSK-0765 board-sync: a merge leaves its card PENDING in the tracker
      // and nothing advances (commit, new PR, another merge; push and the end of
      // the turn go through violations()) until the card is moved. The board is
      // true at all times or the method stops — never a rule in the agent's memory.
      const MERGE = /\\bgh\\s+pr\\s+merge(\\s+(\\d+))?/;
      const ADVANCE = /\\bgit\\s+commit\\b|\\bgit\\s+push\\b|\\bgh\\s+pr\\s+create\\b/; // push also falls under violations() — explicit here too (review catch)
      const mergeM = cmd.match(MERGE);
      const pend = pendingMoves(load().sessions?.[sid]);
      if (pend.length > 0 && (mergeM || ADVANCE.test(cmd))) {
        if (escOn("KJ_ALLOW_BOARD")) { recordEscape(sid, "KJ_ALLOW_BOARD", tool); }
        else {
          console.error("kj sentinel: board-sync — el metodo no avanza con cards mergeadas sin mover:\\n" + pend.map((p) => "- " + pendingText(p)).join("\\n") + "\\n(KJ_ALLOW_BOARD=1 = excepcion consciente, queda registrada)");
          process.exit(2);
        }
      }
      // (the pending entry itself is recorded by the PostToolUse hook, only once
      // gh confirms "merged pull request #N" — a failed merge never blocks)
      if (PUBLISH.test(cmd)) {
        if (escOn("KJ_ALLOW_RELEASE")) { recordEscape(sid, "KJ_ALLOW_RELEASE", tool); process.exit(0); }
        const res = spawnSync("kj", ["release", "check", "--json"], { cwd: ROOT, encoding: "utf8" });
        if (res.error || res.status === null) process.exit(0);
        if (res.status !== 0) {
          let items = "";
          try { items = (JSON.parse(res.stdout).checks || []).filter((c) => !c.ok).map((c) => "\\n- " + c.name + ": " + c.detail).join(""); } catch { /* raw output */ }
          console.error("kj sentinel: release check en ROJO — no se publica ni despliega hasta resolverlo:" + (items || "\\n- corre kj release check para el detalle") + "\\n(KJ_ALLOW_RELEASE=1 = excepcion consciente, queda registrada)");
          process.exit(2);
        }
      } else if (PUSH.test(cmd)) {
        // KJC-BUG-0147: the board escape covers the push too — a pending move
        // blocks the push like it blocks the commit, and the SAME conscious,
        // recorded escape opens both (multi-PR cards are a legitimate plan).
        const sess = load().sessions?.[sid];
        let v = violations(sess, branchOf());
        if (v.length && pendingMoves(sess).length && escOn("KJ_ALLOW_BOARD")) {
          recordEscape(sid, "KJ_ALLOW_BOARD", tool);
          v = violations({ ...sess, pending_moves: [] }, branchOf());
        }
        if (v.length) {
          console.error("kj sentinel: git push con el metodo en rojo:\\n" + v.map((x) => "- " + x).join("\\n") + "\\nResuelve antes de empujar. Estado: kj sentinel status");
          process.exit(2);
        }
      }
    }
  } catch { /* fail open */ }
  process.exit(0);
});
`;

const SCRIPT_BODIES = {
  "sentinel-lib.mjs": LIB_BODY,
  "posttooluse.mjs": POST_BODY,
  "stop.mjs": STOP_BODY,
  "pretooluse-sentinel.mjs": PRETOOL_BODY,
};

/**
 * Tamper detection (KJC-TSK-0715): compare the on-disk harness scripts with
 * what THIS kj install would write. The root of trust is the installed kj
 * package — outside the project tree, beyond the session's tool reach —
 * because nothing under .karajan can vouch for itself.
 */
export function verifySentinelScripts({ projectDir } = {}) {
  const dir = join(projectDir || resolveSentinelRoot(), ".karajan", "harness");
  const mismatched = [];
  for (const [name, body] of Object.entries(SCRIPT_BODIES)) {
    try {
      if (readFileSync(join(dir, name), "utf8") !== body) mismatched.push(name);
    } catch {
      mismatched.push(name);
    }
  }
  return { ok: mismatched.length === 0, mismatched };
}

/** Write the sentinel scripts (shared lib + state writer + gates) and wire them. */
export function installSentinelHooks({ projectDir = process.cwd(), logger = console } = {}) {
  const [lib, post, stop, pre] = Object.entries(SCRIPT_BODIES).map(([name, body]) =>
    writeHarnessScript(projectDir, name, body),
  );
  const { wired } = mergeClaudeHooks({
    projectDir,
    logger,
    entries: [
      { event: "PreToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit", script: "pretooluse-sentinel.mjs" },
      { event: "PreToolUse", matcher: "Bash", script: "pretooluse-sentinel.mjs" },
      { event: "PostToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit", script: "posttooluse.mjs" },
      // KJC-TSK-0765 board-sync: the merge (Bash) and the tracker move (MCP
      // update_card) are observed AFTER the fact — found live: with only the
      // edit matchers wired, the board-sync recorder never ran in production.
      { event: "PostToolUse", matcher: "Bash", script: "posttooluse.mjs" },
      { event: "PostToolUse", matcher: "mcp__.*__update_card", script: "posttooluse.mjs" },
      { event: "Stop", script: "stop.mjs" },
    ],
  });
  return { scripts: [lib, post, stop, pre], wired };
}
