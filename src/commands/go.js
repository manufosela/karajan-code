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
import { createCliAskQuestion } from "../utils/cli-ask-question.js";
import { envInstallCommand } from "./env.js";
import { boardCommand } from "./board.js";
// The interactive launchers a muggle can live inside (v1: the two the epic
// names). Auth heuristics are the same cheap file checks reviewer-fallback
// uses: menu signal, never a spawned process.
export const MAGGLE_AGENTS = [
  { name: "claude", label: "Claude Code (Anthropic)", authPaths: [".claude.json", ".claude"], install: "npm install -g @anthropic-ai/claude-code", login: "claude   (sigue el enlace de inicio de sesión que te muestre)" },
  { name: "codex", label: "Codex (OpenAI)", authPaths: [".codex/auth.json"], install: "npm install -g @openai/codex", login: "codex login" },
];
export async function detectMaggleAgents({ home = os.homedir(), checkBin = checkBinary } = {}) {
  return Promise.all(
    MAGGLE_AGENTS.map(async (a) => {
      let installed = false;
      try { installed = (await checkBin(a.name)).ok; } catch { /* not installed */ }
      const authenticated = installed && a.authPaths.some((p) => existsSync(path.join(home, p)));
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
async function defaultPrepare({ config, logger }) {
  await envInstallCommand({ config, logger, flags: { yes: true } });
}
async function defaultBoard({ config, logger }) {
  const port = config.hu_board?.port || 4000;
  await boardCommand({ action: "start", port, bind: "127.0.0.1", logger });
  await boardCommand({ action: "open", port, bind: "127.0.0.1", logger });
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
export async function goCommand({ config = {}, logger = console, flags = {}, deps = {} } = {}) {
  const projectDir = config.projectDir || process.cwd();
  const agents = await (deps.detect ?? detectMaggleAgents)();
  const ready = agents.filter((a) => a.installed && a.authenticated);
  const needLogin = agents.filter((a) => a.installed && !a.authenticated);
  if (ready.length === 0) {
    if (needLogin.length > 0) {
      logger.error?.("Tienes el agente instalado pero falta iniciar sesión — eso solo puedes hacerlo tú (la cuenta es tuya; Karajan nunca toca tus credenciales):");
      for (const a of needLogin) logger.error?.(`  ${a.label}:  ${a.login}`);
      logger.error?.("Cuando hayas iniciado sesión, vuelve a escribir: kj go");
    } else {
      logger.error?.("Karajan trabaja con un agente de IA que aún no tienes instalado. Elige uno, instálalo con su comando, e inicia sesión con TU cuenta (la cuenta es tuya):");
      for (const a of agents) logger.error?.(`  ${a.label}:  ${a.install}`);
      logger.error?.("Después, vuelve a escribir: kj go");
    }
    process.exitCode = 1;
    return 1;
  }
  let chosen = ready[0];
  if (ready.length > 1) {
    const ask = deps.ask ?? createCliAskQuestion({ flags });
    const answer = await ask("¿Con cuál de tus agentes quieres trabajar?", { options: ready.map((a) => a.name), default: ready[0].name });
    chosen = ready.find((a) => a.name === String(answer).trim()) ?? ready[0];
  }
  logger.info?.(`Trabajarás con ${chosen.label}.`);
  // Prepare ONCE: decisions already taken are never re-asked.
  if (!existsSync(path.join(projectDir, ".karajan", "review-gate"))) {
    logger.info?.("Preparando tu proyecto (solo la primera vez)…");
    await (deps.prepare ?? defaultPrepare)({ config, logger });
  }
  // The board is the muggle's window — unless the project turned it off
  // (hu_board.enabled false is respected: KJC-BUG-0152). A board failure is
  // said and never stops the conversation from starting.
  if (config.hu_board?.enabled !== false) {
    try { await (deps.board ?? defaultBoard)({ config, logger }); } catch (err) { logger.warn?.(`El tablero no pudo abrirse (${err.message}) — la conversación arranca igual.`); }
  }
  const prompt = (deps.prompt ?? buildGoPrompt)();
  logger.info?.("Abriendo tu conversación… (escribe ahí lo que necesites, en tu idioma)");
  const code = await (deps.launch ?? defaultLaunch)(chosen, prompt);
  process.exitCode = code;
  return code;
}
