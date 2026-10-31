/**
 * `kj go` (MGL-A, KJC-TSK-0808, epic KJC-PCS-0084) — the muggle launcher.
 * One command for a person with no computing background: detect their agents,
 * ask AT MOST one question, prepare the project silently, open the board, and
 * leave them inside a conversation that already knows the method. What cannot
 * be hidden is said honestly: the agent's account and login are THEIRS — kj
 * never touches credentials. Everything is injectable so tests spawn nothing.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { checkBinary } from "../utils/agent-detect.js";
import { agentAuthFiles } from "../utils/agent-home.js";
import { createCliAskQuestion } from "../utils/cli-ask-question.js";
import { bootstrapCommand } from "./bootstrap.js";
import { boardCommand } from "./board.js";
// The interactive launchers a muggle can live inside (v1: the two the epic
// names). Auth heuristics are the same cheap file checks reviewer-fallback
// uses: menu signal, never a spawned process.
export const MAGGLE_AGENTS = [
  { name: "claude", label: "Claude Code (Anthropic)", authPaths: [".claude.json", ".claude"], install: "npm install -g @anthropic-ai/claude-code", login: "claude   (sigue el enlace de inicio de sesión que te muestre)" },
  { name: "codex", label: "Codex (OpenAI)", authPaths: [".codex/auth.json"], install: "npm install -g @openai/codex", login: "codex login" },
];
export async function detectMaggleAgents({ home = os.homedir(), env = process.env, checkBin = checkBinary } = {}) {
  return Promise.all(
    MAGGLE_AGENTS.map(async (a) => {
      let installed = false;
      try { installed = (await checkBin(a.name)).ok; } catch { /* not installed */ }
      // KJC-TSK-1344: the session lives where CLAUDE_CONFIG_DIR / CODEX_HOME point.
      const files = agentAuthFiles(a.name, { home, env }) ?? a.authPaths.map((p) => path.join(home, p));
      const authenticated = installed && files.some((f) => existsSync(f));
      return { ...a, installed, authenticated };
    }),
  );
}
/** The session's opening prompt — SHORT and in plain language. The full
 * playbook already lives in the agent files env-install wrote; duplicating it
 * here would dilute it. This prompt sets the tone for a muggle. */
export function buildGoPrompt() {
  return [
    "Arrancas dentro de un proyecto gobernado por Karajan (las reglas del método ya están en los ficheros de agente de este proyecto: síguelas siempre).",
    "La persona que te habla puede no saber programar. Habla en lenguaje llano: sin jerga, sin siglas sin explicar, y resume cada resultado en una o dos frases antes del detalle.",
    "Antes de cambios importantes, di en llano qué vas a hacer y qué pasará. Si algo falla, explica qué pasó y cuál es el siguiente paso — nunca un volcado de error a secas.",
    "El tablero del proyecto está abierto en su navegador: cuando termines algo, recuérdale que puede verlo ahí.",
    "Empieza presentándote en dos frases y preguntando qué quiere construir o cambiar hoy.",
  ].join("\n");
}
export async function defaultBoard({ config, logger, runBoard = boardCommand, openPath = "/?maggle=1" }) {
  const port = config.hu_board?.port || 4000;
  await runBoard({ action: "start", port, bind: "127.0.0.1", logger });
  // /?maggle=1 switches the frontend to plain language (KJC-TSK-0810) —
  // the muggle's window opens already speaking their language. With
  // &window=1 (KJC-TSK-0816) the conversation itself lives IN the board.
  await runBoard({ action: "open", port, bind: "127.0.0.1", path: openPath, logger });
}
function defaultLaunch(agent, prompt) {
  // Interactive session: the muggle LIVES here. CLAUDECODE is stripped so a
  // nested Claude does not refuse to start (the known subprocess quirk).
  const { CLAUDECODE: _omit, ...env } = process.env;
  return new Promise((resolvePromise) => {
    const child = spawn(agent.name, [prompt], { stdio: "inherit", env });
    child.on("exit", (code) => resolvePromise(code ?? 0));
    child.on("error", (err) => {
      console.error(`No se pudo arrancar ${agent.label}: ${err.message}`);
      resolvePromise(1);
    });
  });
}
const failed = () => {
  process.exitCode = 1;
  return 1;
};

// No agent ready: say what only the person can do (log in, or install one).
function explainNoAgent(agents, logger) {
  const needLogin = agents.filter((a) => a.installed && !a.authenticated);
  if (needLogin.length > 0) {
    logger.error?.("Tienes el agente instalado pero falta iniciar sesión — eso solo puedes hacerlo tú (la cuenta es tuya; Karajan nunca toca tus credenciales):");
    for (const a of needLogin) logger.error?.(`  ${a.label}:  ${a.login}`);
    logger.error?.("Cuando hayas iniciado sesión, vuelve a escribir: kj go");
    return;
  }
  logger.error?.("Karajan trabaja con un agente de IA que aún no tienes instalado. Elige uno, instálalo con su comando, e inicia sesión con TU cuenta (la cuenta es tuya):");
  for (const a of agents) logger.error?.(`  ${a.label}:  ${a.install}`);
  logger.error?.("Después, vuelve a escribir: kj go");
}

// At most one question, and only when more than one agent is ready.
async function chooseAgent(ready, { flags, deps }) {
  if (ready.length === 1) return ready[0];
  const ask = deps.ask ?? createCliAskQuestion({ flags });
  const answer = await ask("¿Con cuál de tus agentes quieres trabajar?", { options: ready.map((a) => a.name), default: ready[0].name });
  return ready.find((a) => a.name === String(answer).trim()) ?? ready[0];
}

// Prepare ONCE: decisions already taken are never re-asked. Resolves false
// when something is left for the person's hands (already said above).
async function prepareOnce({ projectDir, config, logger, deps }) {
  if (existsSync(path.join(projectDir, ".karajan", "review-gate"))) return true;
  logger.info?.("Preparando tu proyecto (solo la primera vez)…");
  // BOOT-A paso 3 (KJC-TSK-0857): el orden vive en UN sitio, kj bootstrap.
  // Antes esta puerta cableaba su propia secuencia (git init y env install),
  // así que la puerta del maggle y la técnica podían separarse sin que nadie
  // se diera cuenta. Ahora las dos hacen lo mismo.
  const booted = await (deps.bootstrap ?? bootstrapCommand)({ config, logger, flags: {}, deps: {} });
  if (!booted.ok) {
    logger.error?.(`Falta una cosa que solo puedes hacer tú, la tienes justo arriba (${booted.pending}). Cuando la hagas, vuelve a escribir: kj go`);
    return false;
  }
  const prepared = deps.prepare ? await deps.prepare({ config, logger }) : null;
  // Algo depende de tus manos (arriba tienes el detalle). Sin eso el
  // proyecto quedaría a medias, así que paramos aquí en vez de seguir.
  if (prepared?.exitCode) {
    logger.error?.("Falta una cosa que solo puedes hacer tú, la tienes justo arriba. Cuando la hagas, vuelve a escribir: kj go");
    return false;
  }
  return true;
}

// The board is the muggle's window — unless the project turned it off
// (hu_board.enabled false is respected: KJC-BUG-0152). A board failure is
// said and never stops the conversation from starting. Resolves whether it opened.
async function openBoard({ config, logger, deps, windowMode }) {
  if (config.hu_board?.enabled === false) return false;
  const openPath = windowMode ? "/?maggle=1&window=1" : "/?maggle=1";
  try {
    await (deps.board ?? defaultBoard)({ config, logger, openPath });
    return true;
  } catch (err) {
    logger.warn?.(`El tablero no pudo abrirse (${err.message}) — la conversación arranca igual.`);
    return false;
  }
}

export async function goCommand({ config = {}, logger = console, flags = {}, deps = {} } = {}) {
  const projectDir = config.projectDir || process.cwd();
  const agents = await (deps.detect ?? detectMaggleAgents)();
  const ready = agents.filter((a) => a.installed && a.authenticated);
  if (ready.length === 0) {
    explainNoAgent(agents, logger);
    return failed();
  }
  const chosen = await chooseAgent(ready, { flags, deps });
  logger.info?.(`Trabajarás con ${chosen.label}.`);
  if (!(await prepareOnce({ projectDir, config, logger, deps }))) return failed();
  const prompt = (deps.prompt ?? buildGoPrompt)();
  // --window (MGL-E, ADR 0008): la conversación vive DENTRO del board — el
  // daemon hereda por env (HU_BOARD_TERMINAL_CWD/AGENT/PROMPT) el cwd, el
  // agente elegido y el prompt inicial, y el pty arranca el agente REAL
  // (harness intacto). La fase 1 sigue siendo el default: sin el flag,
  // nada cambia.
  const windowMode = Boolean(flags.window);
  if (windowMode) {
    process.env.HU_BOARD_TERMINAL_CWD = projectDir;
    process.env.HU_BOARD_TERMINAL_AGENT = chosen.name;
    process.env.HU_BOARD_TERMINAL_PROMPT = prompt;
  }
  const boardOpened = await openBoard({ config, logger, deps, windowMode });
  if (windowMode && boardOpened) {
    logger.info?.("Tu conversación vive en la ventana del navegador que se acaba de abrir. Si el tablero ya estaba arrancado de antes, reinícialo con kj board stop && kj go --window para que recoja este proyecto.");
    process.exitCode = 0;
    return 0;
  }
  if (windowMode) {
    // Sin board no hay ventana: se dice y la conversación arranca en la
    // terminal — el maggle nunca se queda sin sesión (catch de codex).
    logger.warn?.("Sin tablero no hay ventana única: abro la conversación aquí mismo.");
  }
  logger.info?.("Abriendo tu conversación… (escribe ahí lo que necesites, en tu idioma)");
  const code = await (deps.launch ?? defaultLaunch)(chosen, prompt);
  process.exitCode = code;
  return code;
}
