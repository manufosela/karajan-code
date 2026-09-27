/**
 * harness-hooks — the TOOL gate (KJC-TSK-0710, from proposal KJC-PRP-0013).
 * Field case 2026-08-02: text rules were not enough — the environment must
 * impose them AT TOOL TIME. `kj harden` writes a PreToolUse script and wires
 * it into the project's `.claude/settings.json` (merged, never clobbered):
 * Write over an existing file blocks ("use Edit", KJ_ALLOW_WRITE=1 escapes);
 * Bash that reserializes whole JSON files blocks (KJ_ALLOW_REWRITE=1).
 * Claude-only v1 — the abstraction arrives with the second host that
 * supports tool hooks.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_BODY = `#!/usr/bin/env node
// kj tool gate (KJC-TSK-0710) — managed by \`kj harden\`. Exit 2 blocks the
// tool call (stderr explains why); anything unexpected fails OPEN (exit 0)
// so a gate bug never bricks the session.
import console from "node:console";
import process from "node:process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// El guard vive en <repo>/.karajan/harness/, asi que el arbol es dos arriba.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { tool_name: tool, tool_input: input = {} } = JSON.parse(raw);
    if (tool === "Write" && process.env.KJ_ALLOW_WRITE !== "1") {
      if (input.file_path && existsSync(input.file_path)) {
        console.error("kj tool gate: Write over an EXISTING file destroys unseen changes — use Edit for targeted changes (KJ_ALLOW_WRITE=1 to override consciously).");
        process.exit(2);
      }
    }
    if (tool === "Bash") {
      const cmd = String(input.command || "");
      // KJC-BUG-0227: el escape tambien viaja en el PROPIO comando, como en el
      // resto de guardias. Mirando solo process.env el agente no tenia salida:
      // un export dentro del comando jamas llega a este proceso.
      // Solo cuentan las asignaciones DEL PRINCIPIO, que son las que el shell
      // aplica al comando. Buscarla en cualquier parte del texto dejaba pasar
      // un "echo KJ_ALLOW_REWRITE=1; python3 ..." (catch de la review).
      const toks = cmd.trim().split(/\\s+/);
      let i = 0;
      let named = false;
      while (i < toks.length && /^[A-Z][A-Z0-9_]*=/.test(toks[i])) {
        if (toks[i] === "KJ_ALLOW_REWRITE=1") named = true;
        i += 1;
      }
      // Una asignacion delante solo alcanza a SU comando, asi que el escape del
      // comando vale unicamente en un comando SIMPLE: en "VAR=1 true && python"
      // o "VAR=1 && python" el python nunca la recibe (catch de la review). Lo
      // que va entre comillas no encadena nada, asi que no cuenta.
      // Tampoco es simple si hay sustitucion: el proceso de dentro de $( ) no
      // hereda la asignacion (catch de la review). Mismo criterio que el resto
      // de guardias del Sentinel.
      // Dentro de comillas SIMPLES todo es literal; dentro de dobles, un ; no
      // encadena pero $( ) si ejecuta. Por eso se miran dos cosas distintas.
      const noSingle = cmd.replaceAll(/'[^']*'/g, "");
      const substitutes = noSingle.includes("$(") || noSingle.includes("\\u0060");
      const bare = noSingle.replaceAll(/"[^"]*"/g, "");
      const simple = !substitutes && !/[;&|]/.test(bare) && !bare.includes("\\n");
      const cmdEscape = named && simple && i < toks.length;
      const escaped = process.env.KJ_ALLOW_REWRITE === "1" || cmdEscape;
      // Un escape ignorado EN SILENCIO era el bug: si esta puesto y no vale, se dice.
      if (named && !cmdEscape) console.error("kj tool gate: KJ_ALLOW_REWRITE=1 presente pero IGNORADO — solo vale delante del comando y en uno simple (sin ; | & fuera de comillas).");
      const writes = /open\\s*\\([^)]*["'][wa]["']|>\\s*\\S+\\.json\\b/.test(cmd);
      // KJC-BUG-0227: y solo se vigila lo que esta DENTRO del arbol. Un fichero
      // temporal del scratchpad no es asunto de este guard, y bloquearlo
      // ensenaba a rodearlo. Sin ruta reconocible se vigila: el lado seguro.
      const targets = cmd.match(/[\\w./-]+\\.json\\b/g) || [];
      // Solo se exime lo que se puede establecer CON CERTEZA: una ruta absoluta
      // fuera del arbol. Una relativa depende del cwd del shell, que este hook
      // no conoce — "cd packages && ... open(\\"../package.json\\")" escribe
      // dentro del repo (catch de la review), asi que se sigue vigilando.
      // Un enlace puede apuntar dentro: /tmp/link.json escribiria en el repo
      // (catch de la review). Se resuelve el padre real antes de clasificar, y
      // si no se puede resolver, se vigila.
      // Fuera del arbol es SALIR de el, no que el nombre empiece por dos puntos:
      // <repo>/..config.json esta dentro (catch de la review).
      const escapesRoot = (rel) => rel === ".." || rel.startsWith("../");
      const outsideForSure = (t) => {
        if (!t.startsWith("/")) return false;
        const abs = resolve(t);
        try {
          const root = realpathSync(ROOT);
          // El propio fichero puede SER el enlace (/tmp/link.json -> repo/cfg.json),
          // asi que se resuelve entero cuando existe; si aun no existe, manda su
          // directorio real.
          if (existsSync(abs)) return escapesRoot(relative(root, realpathSync(abs)));
          const parts = abs.split("/");
          const name = parts.pop();
          return escapesRoot(relative(root, realpathSync(parts.join("/") || "/") + "/" + name));
        } catch {
          return false;
        }
      };
      // Con expansion del shell no se sabe a donde apunta nada: "$PWD/cfg.json"
      // deja el trozo "/cfg.json", que parece absoluto y ajeno sin serlo (catch
      // de la review). Ante la duda se vigila.
      const expands = /[$~]/.test(cmd) || cmd.includes("\\u0060");
      const mine = expands || targets.length === 0 || !targets.every(outsideForSure);
      if (!escaped && mine && /json\\.dumps?\\s*\\(/.test(cmd) && writes) {
        console.error("kj tool gate: reserializing a whole JSON file makes the diff unreviewable — make targeted edits instead (KJ_ALLOW_REWRITE=1 to override consciously).");
        process.exit(2);
      }
    }
  } catch { /* fail open */ }
  process.exit(0);
});
`;

/** Write a managed hook script under .karajan/harness/ and return its path. */
/**
 * KJC-BUG-0211: el cuerpo canonico de los guardias que instala ESTE modulo,
 * para que quien verifica un sello pueda RECOMPUTAR en vez de fiarse del hash.
 */
export const HARNESS_BODIES = { "pretooluse.mjs": SCRIPT_BODY };

export function writeHarnessScript(projectDir, name, body) {
  const dir = join(projectDir, ".karajan", "harness");
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, name);
  writeFileSync(abs, body, { mode: 0o755 });
  return abs;
}

/**
 * Merge hook entries into .claude/settings.json. Preserve, never clobber:
 * invalid JSON or a hook event with an unexpected (non-array) shape is the
 * user's business — the file is left alone and the caller wires manually.
 * entries: [{ event, matcher?, script }] where script is a .karajan/harness
 * basename; an entry is present when that script already appears under the
 * same event (and matcher, when given).
 */
export function mergeClaudeHooks({ projectDir, logger = console, entries }) {
  const settingsPath = join(projectDir, ".claude", "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      logger.warn?.(`kj harden: ${settingsPath} is not valid JSON — leaving it untouched (hook scripts written, wire them manually)`);
      return { wired: false };
    }
  }
  settings.hooks = settings.hooks || {};
  for (const { event } of entries) {
    if (event in settings.hooks && !Array.isArray(settings.hooks[event])) {
      logger.warn?.(`kj harden: ${settingsPath} has a non-array hooks.${event} — leaving it untouched (hook scripts written, wire them manually)`);
      return { wired: false };
    }
  }
  for (const { event, matcher, script } of entries) {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const present = list.some(
      (e) => JSON.stringify(e).includes(script) && (matcher === undefined || e?.matcher === matcher),
    );
    if (!present) {
      const cmd = { type: "command", command: `node ${join(".karajan", "harness", script)}` };
      list.push(matcher === undefined ? { hooks: [cmd] } : { matcher, hooks: [cmd] });
    }
    settings.hooks[event] = list;
  }
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { wired: true };
}

/**
 * La raiz del proyecto: el toplevel de git, o el directorio dado si no hay git.
 * Vive aqui y no se importa de sentinel-hooks porque ese modulo importa de
 * este: el ciclo rompe la carga.
 */
function resolveProjectRoot(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || dir;
  } catch {
    return dir;
  }
}

/** Write the script and merge the PreToolUse entries into .claude/settings.json. */
export function installHarnessHooks({ projectDir = process.cwd(), logger = console } = {}) {
  // KJC-BUG-0223: el harness es del proyecto y vive en su raiz. Instalado desde
  // un subdirectorio sembraba ahi un segundo `.karajan/harness` que no gobierna
  // nada, y el gate seguia mirando otro sitio.
  const root = resolveProjectRoot(projectDir);
  if (root !== projectDir) logger?.info?.(`kj harden: el harness es del proyecto, se instala en su raíz (${root})`);
  projectDir = root;
  const scriptAbs = writeHarnessScript(projectDir, "pretooluse.mjs", SCRIPT_BODY);
  const { wired } = mergeClaudeHooks({
    projectDir,
    logger,
    entries: [
      { event: "PreToolUse", matcher: "Write", script: "pretooluse.mjs" },
      { event: "PreToolUse", matcher: "Bash", script: "pretooluse.mjs" },
    ],
  });
  return { script: scriptAbs, wired };
}
