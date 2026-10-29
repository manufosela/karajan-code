#!/usr/bin/env node
// kj sentinel pretooluse gate (KJC-TSK-0714) — managed by `kj harden`.
// Consults the session method state BEFORE the tool runs: the rule fires
// before the damage, not in the post-mortem. Exit 2 blocks (stderr says the
// remediation); read-only tools are never wired here; every honored escape
// is recorded as an auditable event. Fails OPEN on anything unexpected.
import console from "node:console";
import process from "node:process";
import { dirname, join, relative, resolve } from "node:path";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { doc, CODE, TESTS, ROOT, BASE_BRANCHES, CARD, STATE, branchOf, enterLane, holdLane, laneFor, laneRefusal, laneTop, load, save, session, boardGate, pendingMoves, pendingText } from "./sentinel-lib.mjs";
// KJC-TSK-0915 (ADR 0014): the shell reader is a real, unit-tested module copied here as is.
import { isGhIssueCreate, isPublishCommand, isReadOnlyCommand, optionValues, shellSegments, stripInertQuotes, stripTextOptionValues, stripTextOnlyCommandValues } from "./sentinel-shell.mjs";
import { DISCARD_VERBS, discardOf, foreignLost, removedFiles } from "./sentinel-discard.mjs";
import { sandboxCovers, shellWrites, writesRepo } from "./sentinel-bash-write.mjs";
const EDIT_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const inOrder = (want, got) => { let i = 0; for (const w of got) if (w === want[i] && ++i === want.length) return true; return false; };
// KJC-BUG-0333: a publish is read per simple command by the shell reader, so
// words inside a quoted argument of another command are not a publish.
const isPublish = isPublishCommand;
const PROTECTED = /\.claude\/settings\.json\b|\.karajan\/(hooks|harness)\//;
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { session_id: sid = "default", tool_name: tool, tool_input: input = {}, transcript_path: transcript = null, cwd = null } = JSON.parse(raw);
    enterLane(load(), sid, cwd);
    // KJC-TSK-0920 (SNT-E): every deny ends with the same line, whatever gate it was.
    // KJC-TSK-0968 (HUM-E, ADR 0018): and leaves a record next to the state, with the
    // gate's own words: kj handoff takes the why from here, never from the agent.
    const said = [];
    const errOrig = console.error.bind(console);
    console.error = (m) => { said.push(String(m)); errOrig(m); };
    process.on("exit", (code) => {
      if (code !== 2) return;
      errOrig("karajan: Karajan gobierna y se le obedece. No rodees el gate ni cambies la politica para pasarlo; si te parece injusto, diselo a tu usuario o usa kj report-issue.");
      // Only what a handoff needs: the exact Bash command, or the path an edit aimed at; never file contents.
      const what = tool === "Bash" ? { command: input.command } : { file_path: input.file_path || input.notebook_path || null };
      try { appendFileSync(join(dirname(STATE), "denials.jsonl"), JSON.stringify({ at: new Date().toISOString(), sid, tool, input: what, why: said.join("\n") }) + "\n"); } catch { /* the deny stands without its record */ }
    });
    // KJC-BUG-0238 (#1886): de quien es cada cambio. La primera vez que la
    // sesion toca un fichero se anota si estaba limpio: solo entonces un
    // descarte posterior pierde nada mas que lo de la sesion. Antes de
    // cualquier escape; git que falla cuenta como sucio (fail-closed).
    const noteFirstTouch = (relT) => {
      const st = load();
      const touch = (session(st, sid).first_touch ||= {});
      // hasOwn + defineProperty: a file named __proto__ or toString is a path, not a prototype key.
      if (Object.hasOwn(touch, relT)) return;
      // --ignored: a user's ignored .env is theirs too (git clean -x deletes it).
      const gs = spawnSync("git", ["-C", laneTop(), "status", "--porcelain", "--ignored", "--", relT], { encoding: "utf8" });
      const value = gs.status === 0 && String(gs.stdout).trim() === "" ? "clean" : "dirty";
      Object.defineProperty(touch, relT, { value, enumerable: true, writable: true, configurable: true });
      save(st);
    };
    // Self-protection (KJC-TSK-0715) rules run BEFORE any escape, including
    // KJ_SENTINEL_OFF: the sentinel is not dismantled from inside a session —
    // only the human, editing outside it.
    if (EDIT_TOOLS.includes(tool)) {
      const target = input.file_path || input.notebook_path;
      // ADR 0034: judged in the lane the write lands in (its supervisor, its config).
      const targetTop = target ? laneFor(target) : laneTop();
      const relT = target ? relative(targetTop, String(target)).replaceAll("\\", "/") : "";
      if (relT && PROTECTED.test(relT)) {
        console.error("karajan sentinel: ese fichero es parte del supervisor (" + relT + ") — solo el humano desmonta el sentinel, editalo fuera de la sesion." + doc("supervisor"));
        process.exit(2);
      }
      // KJC-TSK-0920 (SNT-E): policies, gate settings and exclusions are the human's,
      // like the supervisor: a session does not loosen the rules that govern it.
      // .karajan/rules.yml (KJC-TSK-0947, ADR 0016): the compiled rules are the user's to approve.
      // .karajan/rules.local.yml (KJC-TSK-0954, ADR 0017): the same rules, the ones from private sources.
      // .karajan/security-level.json (KJC-TSK-1054, ADR 0020): only kj security writes it, after the human layers.
      if ([".karajan/policy.yml", ".karajan/kj.config.yml", ".karajan/rules.yml", ".karajan/rules.local.yml", ".karajan/security-level.json", ".ragignore"].includes(relT) || relT.endsWith("/.ragignore")) {
        console.error("karajan sentinel: " + relT + " es configuracion de gobierno (politicas, gates, exclusiones): la cambia tu usuario, no la sesion. Si un gate te parece injusto, proponselo a tu usuario o usa kj report-issue." + doc("governance"));
        process.exit(2);
      }
      // The ledger is keyed by path in the session's lane: a write the lane guard will deny records nothing.
      if (targetTop === laneTop() && relT && !relT.startsWith("..") && !relT.startsWith("/")) noteFirstTouch(relT);
    }
    // KJC-BUG-0261: rm / git rm is the session touching those files, noted before they go.
    if (tool === "Bash") for (const words of shellSegments(String(input.command || ""))) for (const f of removedFiles(words, ROOT)) noteFirstTouch(f);
    // Any Bash that NAMES the supervisor's files is denied — a write-verb
    // blocklist is bypassable (cp, dd, one-liners), and reading them is what
    // the Read/Grep tools are for. Shell indirection (variables, globs,
    // substitution) cannot be resolved from command text: that vector is
    // caught by the Stop gate's checksum verification, which blocks the turn.
    // KJC-TSK-1114: where the host sandbox denies writing them, the sandbox guards them instead.
    // KJC-BUG-0425 (ADR 0036): text a command only publishes or stores (a PR description) is not a write.
    // KJC-BUG-0429: nor is a command made only of known readers (an allow-list, not a write blocklist).
    const SUPERVISOR_PATHS = [".claude/settings.json", ".karajan/hooks", ".karajan/harness"];
    if (tool === "Bash" && !isReadOnlyCommand(String(input.command || "")) && PROTECTED.test(stripTextOnlyCommandValues(String(input.command || "")).replaceAll("\\", "/")) && !sandboxCovers(ROOT, SUPERVISOR_PATHS)) {
      console.error("karajan sentinel: los ficheros del supervisor no se tocan desde Bash — consultalos con la tool Read/Grep; solo el humano los modifica, fuera de la sesion." + doc("supervisor"));
      process.exit(2);
    }
    // KJC-BUG-0164: todo gh que PUBLICA texto (pr/issue/release, create/edit/
    // comment/review) se escanea contra el patron de ATRIBUCION a IA antes de
    // salir — comando inline Y ficheros --body-file/--notes-file. Regla
    // determinista del proyecto: prohibido, sin escape. Un fichero ilegible
    // tampoco publica (fail closed).
    {
      // Regex SIN backslashes a proposito (clases de caracteres, emoji
      // literal): asi la plantilla y el fichero generado son identicos y no
      // hay doble-escape que leer mal. KJC-BUG-0402: [-] es un guion y [ ] un espacio; asi,
      // el escaneo de atribucion del pre-commit no toma al detector por una atribucion.
      const ghCmd = String(input.command || "");
      if (tool === "Bash" && /(^|[^a-zA-Z])gh([^a-zA-Z]|$)/.test(ghCmd) && /(^|[^a-z])(pr|issue|release)([^a-z]|$)/.test(ghCmd) && /(^|[^a-z])(create|edit|comment|review)([^a-z]|$)/.test(ghCmd)) {
        const attrib = /co-authored[-]by:.{0,120}(claude|gpt|copilot|gemini)|(generated|written|created) (by|with).{0,120}(claude|gpt|copilot|gemini|codex)|generated[ ]with [[]?claude|🤖/is;
        // KJC-BUG-0340: a body file's PATH is not published text (a scratch dir
        // under .../claude-1000/... read as an attribution next to a title saying
        // "generated by kj"); its content is. Each piece is judged on its own, so a
        // match never spans from the command into a file.
        const pieces = [];
        let cmdText = ghCmd;
        // KJC-BUG-0245: the shell reader ends the path at ; && | (a regex took "pr.md;").
        for (const bodyPath of optionValues(ghCmd, ["--body-file", "--notes-file", "--comment-file"])) {
          cmdText = cmdText.split(bodyPath).join(" ");
          try { pieces.push(readFileSync(bodyPath, "utf8")); } catch {
            console.error("karajan sentinel: no puedo leer " + bodyPath + " para el escaneo de atribucion — sin escaneo no se publica." + doc("attribution"));
            process.exit(2);
          }
        }
        pieces.push(cmdText);
        if (pieces.some((p) => attrib.test(p))) {
          console.error("karajan sentinel: atribucion a IA detectada en contenido a PUBLICAR (PR/issue/release) — prohibida por regla determinista del proyecto: limpia el texto." + doc("attribution"));
          process.exit(2);
        }
      }
    }
    // KJC-BUG-0252 (#1899): una issue para karajan-code sale por kj report-issue
    // (sanitiza y busca duplicados), nunca por gh issue create a mano.
    {
      const ghIssue = String(input.command || "");
      // KJC-BUG-0306: the subcommand itself (gh, its flags, issue create), not three words
      // anywhere: "gh pr create --title 'kj report-issue ...'" is not an issue.
      if (tool === "Bash" && isGhIssueCreate(ghIssue)) {
        // The target: --repo/-R, an inline or inherited GH_REPO, else the
        // checkout's own origin, which is what gh takes (review catches).
        const inlineRepo = /(^|[^A-Z_])GH_REPO=([^ ]+)/.exec(ghIssue);
        let target = optionValues(ghIssue, ["--repo", "-R"]).at(-1) || (inlineRepo ? inlineRepo[2] : "") || String(process.env.GH_REPO || "");
        if (!target) {
          const origin = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: ROOT, encoding: "utf8" });
          target = String(origin.stdout || "").trim();
        }
        if (/karajan-code([^a-z0-9]|$)/i.test(target)) {
          console.error("karajan sentinel: las issues para karajan-code salen por kj report-issue (sanitiza y busca issues parecidas), no por gh issue create." + doc("report-issue"));
          process.exit(2);
        }
      }
    }
    // KJC-TSK-0822 v1.1: la clave del movil (capa 5) no se toca desde la sesion.
    // KJC-TSK-1084 (ADR 0015): los comandos de acto humano (kj harden --commit,
    // kj identity enroll-phone) ya no se leen aqui: la propia orden rechaza un
    // proceso que desciende de un agente (src/harden/human-act.js). Queda el
    // FICHERO de la clave, que solo esto protege hasta que el sandbox lo vete.
    {
      // KJC-BUG-0354: un titulo o un mensaje de commit que solo lo MENCIONA no es escribirlo.
      const namesPhoneFile = stripTextOnlyCommandValues(String(input.command || "")).includes("supervisor-phone.json");
      const writesEnroll = EDIT_TOOLS.includes(tool) && String(input.file_path || "").includes("supervisor-phone.json");
      if ((tool === "Bash" && namesPhoneFile) || writesEnroll) {
        console.error("karajan sentinel: la clave del movil (capa 5) es del humano — supervisor-phone.json no se toca desde la sesion; enrolar es kj identity enroll-phone desde su terminal." + doc("supervisor"));
        process.exit(2);
      }
    }
    // KJC-BUG-0238 (#1886): un agente no descarta cambios que no hizo. Sin
    // escape y antes de KJ_SENTINEL_OFF: es perdida de datos del usuario, y
    // guardarlo (git stash push) nunca pierde nada.
    if (tool === "Bash") {
      const cmdD = String(input.command || "");
      // A git discard nested in $( ), <( ), backticks, eval, xargs or sh -c cannot be read: fail-closed.
      const nested = ["$(", "<(", ">(", String.fromCharCode(96)].some((n) => cmdD.includes(n)) || /(^|[ ;&|])(eval|xargs|bash|sh|zsh|env)( |$)/.test(cmdD);
      if (nested && /(^|[^a-z])git([^a-z]|$)/.test(cmdD) && DISCARD_VERBS.some((v) => cmdD.includes(v))) {
        console.error("karajan sentinel: un descarte git dentro de $( ), backticks, eval, xargs o sh -c no es verificable — ejecutalo como comando simple." + doc("discard"));
        process.exit(2);
      }
      const touch = load().sessions?.[sid]?.first_touch || {};
      for (const words of shellSegments(cmdD)) {
        const d = discardOf(words, ROOT);
        const lost = d ? foreignLost(d, touch, ROOT) : [];
        if (lost.length === 0) continue;
        console.error(d.stash
          ? "karajan sentinel: git stash drop/clear borra trabajo guardado que puede no ser de esta sesion — pideselo a tu usuario." + doc("discard")
          : "karajan sentinel: ese comando descarta cambios que esta sesion no hizo (" + lost.slice(0, 5).join(", ") + (lost.length > 5 ? ", +" + (lost.length - 5) : "") + ") — pueden ser trabajo sin commitear de tu usuario. Si estorban, guardalos recuperables (git stash push -- <ficheros>) y avisale; si el cambio es tuyo sobre su trabajo, deshazlo con Edit. Sin escape: es perdida de datos." + doc("discard"));
        process.exit(2);
      }
    }
    if (process.env.KJ_SENTINEL_OFF === "1") process.exit(0);
    // ADR 0015 (KJC-TSK-0927): no gate has an escape any more, so the command
    // text is read only by the identity lock below.
    const CMD_TEXT = tool === "Bash" ? String(input.command || "") : "";
    const ESC_TAB = String.fromCharCode(9);
    const ESC_NL = String.fromCharCode(10);
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
      const scan = (text, depth) => { if (depth > 3) return; for (const seg of SEPS.reduce((acc, s) => acc.flatMap((l) => l.split(s)), text.split(ESC_NL))) checkSeg(headOf(words(seg)), depth); };
      const checkSeg = (ws, depth) => {
        if (ws.length === 0) return;
        if (WRAPPERS.includes(ws[0])) { // wrapper args have arity (sudo -u bob): scan from the first gh/wrapper token (review catch)
          const j = ws.findIndex((w, i) => i > 0 && ["gh", ...WRAPPERS].includes(bare(w)));
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
        }
        // KJC-TSK-1085 (ADR 0015): git commit/tag/rebase/push are no longer read here:
        // pre-commit checks the author, pre-push every pushed commit and the gh session.
      };
      scan(CMD_TEXT, 0);
      if (problems.length > 0) {
        console.error("karajan sentinel: identity lock (ADR 0005) —" + problems.map((p) => ESC_NL + "- " + p).join("") + ESC_NL + "(sin escape, ADR 0015: pon la cuenta en el comando)" + doc("identity"));
        process.exit(2);
      }
    }
    // MONO-0 (ADR 0002) under ADR 0034 (KJC-TSK-1244): a write in another lane of the SAME
    // repo is allowed while no other live session holds that lane; the session then holds it.
    // A held lane is denied BEFORE the damage. Reads are free.
    // Another lane of this repo => its toplevel; the session's own lane or no repo => null.
    const laneOf = (p) => {
      const top = laneFor(p);
      return top === laneTop() ? null : top;
    };
    const laneDeny = (what, lane) => {
      const why = holdLane(lane);
      if (!why) return false;
      console.error("karajan sentinel: " + what + " vive en otro carril (" + lane + ") de este repo " + why + (laneRefusal() ? " " + laneRefusal() : "") + ". Sin escape (ADR 0015): un cruce deliberado lo hace tu usuario en su terminal." + doc("cross-lane"));
      return true;
    };
    if (EDIT_TOOLS.includes(tool)) {
      const target = input.file_path || input.notebook_path;
      const lane = target ? laneOf(target) : null;
      if (lane && laneDeny(String(target), lane)) process.exit(2);
    }
    if (tool === "Bash") {
      const cmd = String(input.command || "");
      // KJC-BUG-0166/0167: gestionar worktrees crudos (add/remove/prune) es
      // estructura del repo, jamas trabajo de una sesion. 0166: una sesion
      // intento EN BUCLE retirar el ARBOL PRINCIPAL con remove+CROSS_LANE.
      // 0167: un coder descarrilado ANADIO un worktree .verify-main rebelde y
      // de ahi se invento un bootstrap. Deny sin escape en los tres verbos;
      // el cauce sancionado es kj worktree start|done (corre dentro de kj).
      if (/(^|[^a-z])git[^a-z]+worktree[^a-z]+(add|remove|prune)/.test(cmd)) {
        console.error("karajan sentinel: git worktree add/remove/prune no se ejecuta desde una sesion — estructura del repo, sin escape; usa kj worktree start|done." + doc("cross-lane"));
        process.exit(2);
      }
      // KJC-TSK-1114: where the host sandbox denies writing the lanes, it confines Bash itself.
      if (!sandboxCovers(ROOT, [".kj/worktrees"])) {
      // Deny-unless-known-read-only: un allowlist de verbos mutadores era
      // esquivable (dd, interpretes). Solo un comando SIMPLE de lectura (sin
      // encadenar ni redirigir) puede nombrar otro carril; leer carriles es
      // trabajo de las tools Read/Grep, como con los ficheros del supervisor.
      // Solo LITERALES: expansión/sustitución en un comando "de lectura"
      // puede ejecutar cualquier cosa (reviewer catch: grep foo $(rm ...)).
      // (find fuera: -delete/-exec mutan — reviewer catch; sus tokens de
      // carril los caza el escaner de abajo.)
      // KJC-BUG-0338: kj rag query only reads, and the rag-first gate asks for it
      // with a quoted question that names the file.
      const READONLY = /^[ \t]*(grep|rg|cat|head|tail|less|ls|wc|diff|stat|file|du|tree|git (log|show|diff|status|blame)|kj rag query)\b[^;|&<>$`(){}\n\r]*$/;
      // KJC-BUG-0286 (#1982): a command whose EVERY segment only reads mutates
      // nothing, however it is chained (grep | grep, git show | grep, cd && git
      // status). A cd with a literal target is one such segment: the paths after
      // it need no verifying when nothing after it writes. One mutating segment
      // and the whole command is judged below, as before.
      const CD_LITERAL = /^[ \t]*(cd|pushd)([ \t]+[^ \t;|&<>$`(){}\n\r]*)?[ \t]*$/;
      // KJC-BUG-0365: 2>&1 and 2>/dev/null only fold stderr, they write nothing.
      const QUIET = /[ \t]2>(?:&1|\/dev\/null)(?=[ \t]|$)/g;
      const readsOnly = (s) => s.split(/&&|\|\||[;|]/).every((seg) => READONLY.test(seg.replace(QUIET, "")) || CD_LITERAL.test(seg.replace(QUIET, "")));
      // KJC-BUG-0243: operators inside inert quotes (grep -e "a|b") do not chain anything.
      if (!readsOnly(stripInertQuotes(cmd))) {
        // cd/pushd invalida TODO razonamiento textual de rutas posteriores
        // (carrera de bypasses confirmada en review: destino bare, con $,
        // relativas post-cd...): en un comando NO-read-only, cambiar de
        // directorio se deniega conservadoramente — el remedio es no
        // necesitarlo (git -C, npm --prefix, rutas absolutas).
        if (/(^|[;&|(\s])(cd|pushd)([ \t]|$)/.test(cmd)) {
          console.error("karajan sentinel: cd/pushd en un comando mutador — las rutas posteriores no son verificables por el guard de carriles (MONO-0); usa git -C / npm --prefix / rutas ABSOLUTAS sin cd." + doc("cross-lane"));
          process.exit(2);
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
        if (/>{1,2}[ \t]*["']?[$`]/.test(cmd)) {
          console.error("karajan sentinel: redireccion con destino tras variable/sustitucion — el guard de carriles no puede verificarlo (MONO-0); usa una ruta LITERAL." + doc("cross-lane"));
          process.exit(2);
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
        // KJC-BUG-0243: inert quoted text is not a substitution, and the prose value
        // of a text option (--title, -m...) is not a path.
        if (/\$\(|`/.test(stripInertQuotes(cmd)) || quotedPathWithSpaces(stripTextOptionValues(cmd))) {
          console.error("karajan sentinel: sustitucion de comandos o ruta entrecomillada con espacios en un comando mutador — no verificable por el guard de carriles (MONO-0); usa valores/rutas LITERALES sin sustitucion. Si es texto (titulo, descripcion, error) con comillas de codigo o dolar, ponlo entre comillas SIMPLES: entre dobles la shell lo ejecuta." + doc("cross-lane"));
          process.exit(2);
        }
        const SAFE_EXP_SEG = /^([A-Za-z_][A-Za-z0-9_]*=[^ \t]*[ \t]*)*((npm|pnpm|yarn|vitest|jest|kj|gh|echo|printf|true|test)\b|git[ \t](?![^\n]*(-C[ \t]|--git-dir|--work-tree)))[^;|&\n]*$|^[A-Za-z_][A-Za-z0-9_]*=[^;|&\n]*$/;
        const segs = cmd.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
        if (!segs.every((s) => !/[$]/.test(s) || SAFE_EXP_SEG.test(s))) {
          console.error("karajan sentinel: expansion de shell en una herramienta generica de fichero/interprete — el objetivo no es verificable por el guard de carriles (MONO-0); usa rutas LITERALES o un runner del toolchain." + doc("cross-lane"));
          process.exit(2);
        }
        // ...incluidas relativas A PELO (los carriles kj viven en
        // .kj/worktrees/). Un falso token (s/a/b/) resuelve al arbol propio
        // y foreignLane da null — solo deniega lo que CAE en otro carril.
        const seen = new Set();
        for (const m of cmd.matchAll(/(?:^|[\s"'=;(><])((?:\.\.?\/)[^\s"'`;|&)]*|\/[^\s"'`;|&)]+|~\/[^\s"'`;|&)]+|[A-Za-z0-9_.@-]+\/[^\s"'`;|&)]+)/g)) {
          const t = m[1].startsWith("~/") ? (process.env.HOME || "~") + m[1].slice(1) : m[1];
          const abs = resolve(t);
          if (seen.has(abs)) continue;
          seen.add(abs);
          const lane = laneOf(abs);
          if (lane && laneDeny(m[1], lane)) process.exit(2);
        }
      }
      }
    }
    // KJC-BUG-0237 (#1886): the repo is written through Edit/Write only, the path every gate
    // guards. After the lane guard, whose message is the precise one for another lane.
    // KJC-TSK-1114: gates run at commit now; what only this guard kept, the governance
    // files, the host sandbox denies where it covers them.
    if (tool === "Bash" && !sandboxCovers(ROOT, ["kj.config.yml", ".ragignore"])) {
      let moved = false; // after cd/pushd/popd, a relative target cannot be placed: fail-closed
      // $( ) and backticks run even inside double quotes: their bodies, read from the raw text, are commands too.
      const raw = String(input.command || "");
      const subs = [...[...raw.matchAll(/[$][(]([^()]*)[)]/g)].map((m) => m[1]), ...raw.split(String.fromCharCode(96)).filter((_, k) => k % 2 === 1)];
      for (const words of [...shellSegments(raw), ...subs.flatMap((s) => shellSegments(s))]) {
        if (["cd", "pushd", "popd"].includes(words[0])) moved = true;
        const inRepo = shellWrites(words).filter((t) => writesRepo(t, ROOT) || (moved && !t.startsWith("/")));
        if (inRepo.length === 0) continue;
        console.error("karajan sentinel: escribir ficheros del repo desde Bash (" + inRepo.slice(0, 3).join(", ") + ") se salta los gates de Edit/Write — usa la tool Edit/Write; para renombrar, git mv; fuera del repo (/tmp, scratchpad) Bash es libre." + doc("bash-write"));
        process.exit(2);
      }
    }
    // KJC-TSK-0734 (PL-B): con .karajan/policy.yml presente, la evaluacion
    // la hace el MOTOR via kj policy eval --strict (exit 2 = deny, contrato
    // PL-A); los defaults del supervisor viven en el motor y el check
    // PROTECTED inline de arriba queda como red fail-closed si kj falta.
    // Fail CLOSED por defecto (catches de codex; doctrina KJC-BUG-0095: un
    // gate no se cae en silencio): solo exit 0 permite. kj inejecutable =
    // deny duro (el remedio es restaurar kj); cualquier otro fallo de
    // evaluacion = deny sin escape (ADR 0015): un typo de YAML lo corrige el
    // usuario fuera de la sesion.
    if ((EDIT_TOOLS.includes(tool) || tool === "Bash") && existsSync(resolve(ROOT, ".karajan", "policy.yml"))) {
      // PL-C: el rol que ACTÚA (KJ_POLICY_ROLE, sembrado por los runners de
      // kj run en los subprocesos) — el anfitrión-brain evalúa como coder.
      const actorRole = process.env.KJ_POLICY_ROLE || "coder";
      const pres = spawnSync("kj", ["policy", "eval", "--strict", "--role", actorRole, "--tool", tool, "--input", JSON.stringify(input)], { cwd: ROOT, encoding: "utf8" });
      if (pres.error || pres.status === null) {
        console.error("karajan sentinel: .karajan/policy.yml declara enforcement pero kj no es ejecutable — la policy no se puede evaluar; restaura kj en el PATH (npm i -g @karajan-family/code, o el nombre legacy karajan-code) o retira la policy conscientemente." + doc("policy"));
        process.exit(2);
      }
      if (pres.status === 2) {
        let v = null;
        try { v = JSON.parse(String(pres.stdout || "").trim().split("\n").pop()); } catch { /* mensaje generico */ }
        const secure = !!(v && v.class === "security");
        // ADR 0015 (KJC-TSK-0932): no escape; a rule that misfires is fixed by PR.
        console.error("karajan sentinel: policy deny [" + ((v && v.rule_id) || "policy") + "] " + ((v && v.reason) || "la tool call viola la policy del proyecto") + (secure ? " [security — sin escape ni arbitraje]" : " (sin escape: si la regla falla, tu usuario corrige .karajan/policy.yml por PR)") + doc("policy"));
        process.exit(2);
      } else if (pres.status !== 0) {
        // KJC-BUG-0207: un kj que NO ARRANCA no es una violacion de policy. Con
        // kj linkado al arbol, un error de sintaxis transitorio en src/ dejaba
        // la sesion sin Edit, sin Write y sin Bash, o sea sin las herramientas
        // para arreglar el fichero, y el remedio que sugeria (kj policy check)
        // tampoco arrancaba. Se avisa fuerte y se deja pasar: el resto de este
        // guard sigue vigente, que es lo que protege el metodo.
        const broken = /SyntaxError|ReferenceError|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM/.exec(String(pres.stderr || ""));
        // Abrir el gate entero seria un bypass a la carta (romper un modulo y
        // seguir sin policy), catch de la review. Se permite EXACTAMENTE una
        // cosa: editar el fichero que rompe kj. Lo demas sigue denegado.
        const at = broken ? (String(pres.stderr || "").split("\n").map((l) => l.trim()).find((l) => /^[^ ]+\.(m?js|cjs|ts):\d+$/.test(l)) || "") : "";
        // Node localiza los errores de un modulo ESM como file:///ruta.js:124,
        // y esa forma no es una ruta de fichero (catch de la review).
        const asPath = (p) => (p.startsWith("file:") ? fileURLToPath(p) : p);
        const brokenFile = at ? asPath(at.slice(0, at.lastIndexOf(":"))) : "";
        if (broken) {
          const target = input.file_path || input.notebook_path || "";
          const repairing = EDIT_TOOLS.includes(tool) && brokenFile && target && resolve(String(target)) === resolve(brokenFile);
          if (repairing) console.error("karajan sentinel: kj no arranca (" + broken[0] + " en " + at + ") — la policy no se puede evaluar, asi que solo se permite arreglar ESE fichero. Arreglalo y vuelve." + doc("policy"));
          else {
            console.error("karajan sentinel: kj no arranca (" + broken[0] + (at ? " en " + at : "") + "), asi que la policy no se puede evaluar y NADA MAS pasa: edita " + (brokenFile || "el fichero que rompe kj") + " para arreglarlo. No es un deny de policy, es kj roto." + doc("policy"));
            process.exit(2);
          }
        } else {
          console.error("karajan sentinel: kj policy eval fallo (exit " + pres.status + ") — la policy declarada no se pudo evaluar, deny por defecto; diagnostica con kj policy check; .karajan/policy.yml lo corrige tu usuario fuera de la sesion." + doc("policy"));
          process.exit(2);
        }
      }
    }
    if (EDIT_TOOLS.includes(tool)) {
      // STW-C (KJC-TSK-0791): the sweep's verdict has consequence where work
      // STARTS. Inform ALWAYS, once per session and impossible to miss; BLOCK
      // almost never — only security and persistent red main, and only when
      // the project adopted it (method_gates.steward: block). Unknown is never
      // treated as broken: nothing is asserted that is not known. No report =
      // the project does not use the Steward yet — silence, adoption is explicit.
      try {
        const rep = JSON.parse(readFileSync(join(ROOT, ".karajan", "steward", "report.json"), "utf8"));
        const bad = (rep.invariants || []).filter((r) => r.verdict === "broken");
        const stale = (rep.invariants || []).filter((r) => r.verdict === "unknown");
        if (bad.length || stale.length) {
          const hard = bad.filter((r) => r.id === "vulnerable-deps" || r.id === "main-ci");
          let blockOn = false;
          try { blockOn = /steward:\s*["']?block/.test(readFileSync(join(ROOT, ".karajan", "kj.config.yml"), "utf8")); } catch { /* no config — no block */ }
          if (hard.length && blockOn) {
            console.error("karajan sentinel: steward — el estado del proyecto bloquea empezar (barrido " + rep.sweptAt + "):" + String.fromCharCode(10) + hard.map((r) => "- " + r.id + ": " + (r.evidence || "") + " -> " + (r.remedy || r.renew || "kj steward sweep")).join(String.fromCharCode(10)) + String.fromCharCode(10) + "(sin escape, ADR 0015: si el trabajo sigue, tu usuario cambia method_gates.steward a inform)" + doc("steward"));
            process.exit(2);
          }
          const st = load();
          const s = session(st, sid);
          if (!s.steward_informed) {
            s.steward_informed = true;
            save(st);
            const lines = [...bad.map((r) => "ROTO " + r.id + ": " + (r.remedy || r.evidence || "")), ...stale.map((r) => "desconocido " + r.id + " (no se afirma lo que no se sabe) — refresca: " + (r.renew || "kj steward sweep"))];
            console.log(JSON.stringify({ systemMessage: "kj steward (barrido " + rep.sweptAt + "): " + lines.join(" | ") + " — detalle: .karajan/steward/report.md" }));
          }
        }
      } catch { /* no report or unreadable — the Steward is not adopted here */ }
      const file = input.file_path || input.notebook_path;
      // ADR 0034: the card, the branch and the RAG of the lane the write lands in.
      const top = file ? laneFor(file) : laneTop();
      const rel = file ? relative(top, String(file)).replaceAll("\\", "/") : "";
      // KJC-BUG-0279 (#1981): outside the repository there is no source to govern.
      if (rel && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("/") && CODE.test(rel) && !TESTS.test(rel)) {
        const branch = branchOf(top);
        const why = !branch ? null : BASE_BRANCHES.has(branch) ? "base" : !CARD.test(branch) ? "nocard" : null;
        // ADR 0015 (KJC-TSK-0925): no escape. Without a card there is no work.
        if (why) {
          console.error(why === "base"
            ? "karajan sentinel: no se editan fuentes en la rama base '" + branch + "' — crea la card (kj hu add) y la rama: git checkout -b feat/<CARD-ID>-descripcion." + doc("card-first")
            : "karajan sentinel: la rama '" + branch + "' no referencia ninguna card — crea/mueve la card a running (kj hu add | kj hu move) y usa una rama feat/<CARD-ID>-descripcion." + doc("card-first"));
          process.exit(2);
        }
        // KJC-TSK-0848 (ADR 0010, RAG-B): the RAG must have answered about this
        // zone before the session touches it. Covered = the session ledger
        // (RAG-A) holds this file or a sibling of its directory; a NEW file only
        // needs the session to have consulted at all. Same file set as card-first.
        const rs = load().sessions?.[sid] || {};
        const hits = rs.rag_hits || [];
        const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
        // KJC-BUG-0210: nuevo no es "no existe en disco". En cuanto la sesion
        // lo crea, la siguiente edicion exigia una respuesta del RAG sobre un
        // fichero que el indice NO puede tener. El hecho comprobable: un
        // fichero que git no conoce no ha podido indexarse.
        // Solo se pregunta a git en el camino lento, cuando el gate iba a
        // denegar: exit 1 = git responde que no lo conoce; cualquier otro
        // resultado se comporta como hasta ahora y bloquea.
        const fresh = () => !existsSync(String(file)) || spawnSync("git", ["-C", top, "ls-files", "--error-unmatch", "--", rel], { encoding: "utf8" }).status === 1;
        // A path outside this tree is another lane's business (the lane guard
        // above rules on it) and the ledger only holds in-repo paths.
        // KJC-BUG-0190: with nothing indexed, no query can cover anything —
        // the gate asks for kj rag index instead of denying the impossible.
        // KJC-BUG-0308: a barrel only re-exports its folder, so the RAG answers with
        // what it re-exports and never with the barrel: a hit in its own subtree covers it.
        const BARRELS = ["index.js", "index.ts", "index.mjs", "index.cjs", "index.jsx", "index.tsx", "__init__.py", "mod.rs"];
        const barrelCovered = dirOf(rel) !== "" && BARRELS.includes(rel.slice(rel.lastIndexOf("/") + 1)) && hits.some((h) => h.startsWith(dirOf(rel) + "/"));
        const covered = rel.startsWith("..") || hits.includes(rel) || hits.some((h) => dirOf(h) === dirOf(rel)) || barrelCovered || ((rs.rag_queries || []).length > 0 && fresh()) || rs.rag_index_empty === true;
        // ADR 0015 (KJC-TSK-0925): no escape. The cases it covered (new file, empty
        // index, not indexable) are decided by the gate itself.
        if (!covered) {
          {
            // KJC-BUG-0216 (issue #1807): un .astro, un .php o cualquier fichero
            // sin adapter NO puede estar en el indice, asi que exigir una
            // respuesta del RAG sobre el es pedir lo imposible, y empujaba a
            // dejar el escape puesto para siempre. La exencion es SOLO
            // esa: un indice vacio o por detras si tiene arreglo (kj rag index)
            // y sigue bloqueando, porque si no el gate desapareceria en
            // cualquier proyecto sin indexar. Nada legible = se bloquea.
            const cov = spawnSync("kj", ["rag", "covers", rel, "--json"], { cwd: top, encoding: "utf8" });
            let blind = null;
            let absent = null;
            try {
              const c = JSON.parse(String(cov.stdout || ""));
              if (c.state === "not-indexable") blind = c.reason;
              // KJC-TSK-0891: si el indice no tiene el fichero, consultar no puede
              // devolverlo; el remedio es indexarlo, y se nombra.
              if (c.state === "stale" || c.state === "index-empty") absent = c.reason;
            } catch { blind = null; }
            if (blind) {
              console.error("karajan sentinel: rag-first — " + blind + " — no se te exige consultar lo que el indice no puede tener; el gate lo anota y sigue" + doc("rag-first"));
            } else if (absent) {
              console.error("karajan sentinel: rag-first — el indice aun no tiene " + rel + " (" + absent + "); indexalo y consulta despues: kj_rag_query / kj rag query <que hace " + rel + ">" + doc("rag-first"));
              process.exit(2);
            } else {
              // KJC-BUG-0293 (#1996): hits that fell outside the tree are named, so the
              // person learns the index was built from another path instead of querying again.
              const dropped = rs.rag_dropped;
              const outside = dropped?.count
                ? " La ultima consulta devolvio " + dropped.count + " hit(s) fuera de este arbol (" + dropped.root + "): " + (dropped.sample || []).join(", ") + " — el indice se construyo desde otra ruta; reindexa desde esta: kj rag index --with-sources."
                : "";
              console.error("karajan sentinel: rag-first — el RAG no ha respondido sobre " + rel + " en esta sesion; consulta antes de tocarlo: kj_rag_query / kj rag query <que hace " + rel + " y donde mas vive ese concepto>." + outside + doc("rag-first"));
              process.exit(2);
            }
          }
        }
      }
    }
    if (tool === "Bash") {
      const cmd = String(input.command || "");
      // KJC-TSK-0765 board-sync: a merge leaves its card PENDING in the tracker
      // and nothing advances (commit, new PR, another merge; push and the end of
      // the turn go through violations()) until the card is moved. The board is
      // true at all times or the method stops — never a rule in the agent's memory.
      // ENF-B (KJC-TSK-0854): el review es obligatorio, no una sugerencia. Una
      // bandera no puede apagar el gate de commit, y mover core.hooksPath lo
      // apaga entero. El --no-verify que kj harden --commit usa por dentro no
      // pasa por aqui: no es una tool call. Escape humano, sellado como el resto.
      // KJC-BUG-0286 (#1982): judged on the git commit SEGMENT alone, read by the
      // shell reader: a "commit" inside a grep pattern piped after git show, or
      // the -n of a grep in the same pipeline, is not a skipped hook.
      const commitSegments = shellSegments(cmd).map((ws) => ws.map((w) => w.slice(w.lastIndexOf("/") + 1))).filter((ws) => inOrder(["git", "commit"], ws));
      // git acepta abreviaturas no ambiguas de las opciones largas, asi que
      // --no-ver salta el hook igual que --no-verify (catch de la review).
      const shortWithN = (w) => w.length > 1 && w[0] === "-" && w[1] !== "-" && w.includes("n");
      const skipsVerify = (w) => shortWithN(w) || (w.length >= 5 && "--no-verify".startsWith(w));
      // Mover core.hooksPath apaga TODOS los hooks. git tiene varias puertas
      // para lo mismo (config, -c, --config-env, GIT_CONFIG_KEY_n) y no
      // distingue mayusculas en la llave, asi que lo que se vigila es la LLAVE
      // en cualquier posicion (dos catches de la review). Leerla no hace nada.
      // Nombrar la llave basta para denegar: exceptuar las lecturas invitaba a
      // colar una detras del cambio (git config core.hooksPath /x; cat algo),
      // catch de la review. Leerla tiene remedio barato, perderla no.
      // Se busca la llave DENTRO del token y no solo al principio: las formas
      // de inyeccion la empotran (GIT_CONFIG_KEY_0=core.hooksPath,
      // --config-env=core.hooksPath=VAR) y una propiedad de seguridad no puede
      // depender de como parta las palabras el separador (catch de la review).
      const movesHooks = cmd.toLowerCase().includes("core.hookspath");
      if (commitSegments.some((ws) => ws.some(skipsVerify)) || movesHooks) {
        // ADR 0015 (KJC-TSK-0926): no escape. A broken hook is fixed; skipping it,
        // if it ever must happen, is the user's act in their own terminal.
        console.error("karajan sentinel: el gate de commit no se apaga con una bandera — el review cruzado y la policy corren en el hook, y saltarselos deja el diff sin veredicto. Si el hook esta roto, arreglalo; si de verdad hace falta saltarlo, lo hace tu usuario en su terminal." + doc("escapes"));
        process.exit(2);
      }
      // KJC-BUG-0296 (#1989): the staged set is reviewed by name. A blanket
      // git add -A / git add . / git add -u put a Claude scheduler lock into
      // main; and the agent's runtime files (the .claude locks, .kj/, the local
      // identity, the Sentinel state, the harness) are never staged at all.
      // (No backticks in this template: they would end the string.)
      const RUNTIME = /^(\.\/)?(\.claude\/[^/]*\.lock|\.kj\/|\.karajan\/identity\.local\.yml|\.karajan\/harness\/sentinel-state\.json)/;
      for (const ws of shellSegments(cmd)) {
        const gi = ws.findIndex((x) => x.slice(x.lastIndexOf("/") + 1) === "git");
        if (gi < 0) continue;
        // git's own options come before the verb: -C <dir>, -c k=v, --git-dir=…
        let vi = gi + 1;
        while (vi < ws.length && ws[vi].startsWith("-")) vi += ws[vi] === "-C" || ws[vi] === "-c" ? 2 : 1;
        if (ws[vi] !== "add") continue;
        const args = ws.slice(vi + 1);
        // The pathspec: after "--" if present, else every non-option word. "." is
        // the whole tree whichever way it is written; -A/-u with no pathspec too.
        const dash = args.indexOf("--");
        const spec = dash >= 0 ? args.slice(dash + 1) : args.filter((a) => !a.startsWith("-"));
        const whole = spec.some((a) => a === "." || a === "./");
        const blanket = whole || (args.some((a) => a === "-A" || a === "--all" || a === "-u" || a === "--update") && spec.length === 0);
        if (blanket) {
          console.error("karajan sentinel: git add -A / . / -u stagea lo que no has revisado — stagea por nombre (git add -- <ruta>...) y mira git diff --cached --stat antes de commitear." + doc("commit-gate"));
          process.exit(2);
        }
        // Directories too: .kj is runtime whole; .claude and .karajan hold the
        // contract, so only a forced add (-f, past the ignore) reaches their locks.
        const force = args.some((a) => a === "-f" || a === "--force");
        const runtime = spec.find((a) => RUNTIME.test(a) || /^(\.\/)?\.kj\/?$/.test(a) || (force && /^(\.\/)?(\.claude|\.karajan)\/?$/.test(a)));
        if (runtime) {
          console.error("karajan sentinel: " + runtime + " es runtime del agente (locks de .claude, .kj/, identidad local, estado del Sentinel) y no se commitea — fuera del stage." + doc("commit-gate"));
          process.exit(2);
        }
      }
      const MERGE = /\bgh\s+pr\s+merge(\s+(\d+))?/;
      // KJC-TSK-1089: git push is not read any more; pending moves still stop the turn (stop gate).
      const ADVANCE = /\bgit\s+commit\b|\bgh\s+pr\s+create\b/;
      const mergeM = cmd.match(MERGE);
      const pend = pendingMoves(load().sessions?.[sid]);
      if (pend.length > 0 && (mergeM || ADVANCE.test(cmd))) {
        // KJC-BUG-0198: una card partida en varias PRs no puede quedar bloqueada
        // por su primera mitad (boardGate, en la lib).
        const { blocking, carried, reason } = boardGate(sid, pend);
        for (const c of carried) console.error("karajan sentinel: board-sync arrastra " + c.card + " — " + c.why + ", se movera al cerrarla");
        // ADR 0015 (KJC-TSK-0925): no escape; an epic and a card split across PRs
        // are already decided above (KJC-BUG-0230, 0198).
        // KJC-BUG-0363: when kj could not check, its reason travels with the block.
        if (blocking.length > 0) {
          console.error("karajan sentinel: board-sync — el metodo no avanza con cards mergeadas sin mover:\n" + blocking.map((p) => "- " + pendingText(p)).join("\n") + (reason ? "\n(" + reason + ")" : "") + doc("board-sync"));
          process.exit(2);
        }
      }
      // (the pending entry itself is recorded by the PostToolUse hook, only once
      // gh confirms "merged pull request #N" — a failed merge never blocks)
      // CLM-C (KJC-TSK-0803): a PR body outlives the turn — an invented figure
      // there misleads every future reader. When the command writes one from a
      // file, kj crosses ITS data against this turn's outputs; the hook carries
      // no policy (kj reads method_gates.claims; off = this check does not exist).
      // KJC-BUG-0245: the path is read by the shell reader, so "pr.md;" is "pr.md".
      const body = /\bgh\s+pr\s+(?:create|edit)\b/.test(cmd) ? optionValues(cmd, ["--body-file"])[0] : undefined;
      if (body && transcript) {
        const g = spawnSync("kj", ["claims", "gate", "--transcript", transcript, "--file", body], { cwd: ROOT, encoding: "utf8" });
        if (!g.error && g.status === 2) {
          console.error("karajan sentinel: claims — un dato del cuerpo de la PR esta DESMENTIDO por las salidas de este turno:\n" + (g.stderr || "").trim() + "\nVerificalo o marcalo como no comprobado antes de crear la PR. Detalle: kj claims check --transcript " + transcript + " --file " + body + doc("claims"));
          process.exit(2);
        }
      }
      if (isPublish(cmd)) {
        // ADR 0015 (KJC-TSK-0932): no escape — KJC-BUG-0204 and 0259 keep the
        // check from blocking its own fix.
        // KJC-BUG-0204: el check se evalua PARA este comando. Un item que
        // declara remedied_by no bloquea el comando que lo repara (desplegar
        // la landing era justo lo que el check pedia); publicar no se exime.
        const res = spawnSync("kj", ["release", "check", "--json", "--for-command", cmd], { cwd: ROOT, encoding: "utf8" });
        if (res.error || res.status === null) process.exit(0);
        let parsed = null;
        try { parsed = JSON.parse(res.stdout); } catch { /* raw output */ }
        const lifted = (parsed && parsed.lifted) || [];
        if (res.status === 0 && lifted.length > 0) {
          // En voz alta: una exencion que nadie ve no se distingue de un gate que no mira.
          console.error("karajan sentinel: release check en rojo SOLO por lo que este comando repara (" + lifted.join(", ") + ") — pasa, y el resto sigue en verde" + doc("release"));
          process.exit(0);
        }
        if (res.status !== 0) {
          let items = "";
          try { items = (parsed.checks || []).filter((c) => !c.ok && c.lifted !== true).map((c) => "\n- " + c.name + ": " + c.detail).join(""); } catch { /* raw output */ }
          console.error("karajan sentinel: release check en ROJO — no se publica ni despliega hasta resolverlo:" + (items || "\n- corre kj release check para el detalle") + "\n(sin escape: se repara lo que el check nombra)" + doc("release"));
          process.exit(2);
        }
      }
      // KJC-TSK-1089 (ADR 0015): git push is no longer read here. The base branch is
      // protected (required checks), the card and the tests are judged at commit
      // (kj review), and pending card moves keep the turn from ending (stop gate).
    }
  } catch { /* fail open */ }
  process.exit(0);
});
