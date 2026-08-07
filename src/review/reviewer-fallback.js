/**
 * reviewer-fallback (KJC-TSK-0730) — running out of reviewer quota must
 * never leave the method without a third party, and must never be silent:
 * either an authenticated candidate takes over WITH a loud notice, or the
 * user gets a menu of candidates with their tier and the exact login
 * command. Born from the real codex weekly-quota outage of 2026-08-06.
 *
 * The registry is declarative. `install` is only present when the command
 * was VERIFIED (never invent package names); auth heuristics are cheap
 * local file checks — informative for the menu, while the actual failover
 * only sticks if the candidate answers.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkBinary } from "../utils/agent-detect.js";

export const REVIEWER_CANDIDATES = [
  {
    name: "codex",
    tier: "suscripción ChatGPT (cuota semanal compartida entre modelos)",
    login: "codex → Sign in with ChatGPT",
    install: "npm i -g @openai/codex",
    authPaths: [".codex/auth.json"],
  },
  {
    name: "copilot",
    tier: "gratis (tier free de GitHub Copilot; más cuota con suscripción)",
    login: "copilot → autenticación GitHub",
    install: "npm i -g @github/copilot",
    authPaths: [".copilot/config.json"],
  },
  {
    name: "agy",
    tier: "suscripción Google AI Pro/Ultra (sucesor del gemini CLI, retirado 06-2026)",
    login: "agy → /login (cuenta Google)",
    install: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    authPaths: [".agy", ".config/agy", ".antigravity-cli"],
    adapterPending: true,
  },
  {
    name: "kimi",
    tier: "gratis (Kimi Code, Moonshot K2.x)",
    login: "kimi login (device-code; si dice 'No model configured', repítelo)",
    install: null,
    authPaths: [".kimi-code/credentials"],
  },
  {
    name: "qwen",
    tier: "requiere plan o API key (el tier gratis hosted se retiró en 04-2026)",
    login: "qwen → OAuth o API key OpenAI-compatible",
    install: "npm i -g @qwen-code/qwen-code",
    authPaths: [".qwen/oauth_creds.json"],
  },
  {
    name: "aider",
    tier: "API keys propias (pago por token: OpenAI/Anthropic/OpenRouter…)",
    login: "exportar OPENAI_API_KEY / ANTHROPIC_API_KEY (o ~/.aider.conf.yml)",
    install: "pipx install aider-chat || pip3 install aider-chat",
    authPaths: [".aider.conf.yml"],
    authEnv: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"],
  },
  {
    name: "opencode",
    tier: "gratis con modelos locales (LiteLLM/Ollama) o API keys propias",
    login: "provider en ~/.config/opencode/opencode.json",
    install: null,
    authPaths: [".config/opencode/opencode.json"],
  },
];

const QUOTA_RE = /usage limit|quota|rate.?limit|credits? (?:exhausted|left: ?0)|hit your .{0,20}limit/i;

/** True when the agent error smells like exhausted quota, not a real failure. */
export function isQuotaExhausted(text) {
  return typeof text === "string" && QUOTA_RE.test(text);
}

/** installed × authenticated for every candidate, from cheap local checks. */
export async function candidateStatus({ home = os.homedir(), checkBin = checkBinary, env = process.env } = {}) {
  return Promise.all(
    REVIEWER_CANDIDATES.map(async (c) => {
      let installed = false;
      try {
        installed = (await checkBin(c.name)).ok;
      } catch { /* not installed */ }
      // Session-file heuristics, or env keys for CLIs (aider) that carry
      // no session file. Key present ≠ credit left — it is menu signal;
      // the failover only sticks if the candidate actually answers.
      const authenticated =
        c.authPaths.some((p) => existsSync(path.join(home, p))) ||
        (c.authEnv || []).some((name) => Boolean(env[name]));
      return { ...c, installed, authenticated };
    }),
  );
}

/**
 * First candidate that is installed, authenticated, has a kj adapter and is
 * not excluded (the exhausted reviewer and the host — the brain NEVER
 * reviews itself).
 */
export function pickQuotaFallback(statuses, { exclude = [] } = {}) {
  const found = statuses.find(
    (s) => s.installed && s.authenticated && !s.adapterPending && !exclude.includes(s.name),
  );
  return found ? found.name : null;
}

/** Human/agent-readable menu: tier, state, and the exact command per candidate. */
export function formatCandidateMenu(statuses, { exclude = [] } = {}) {
  const lines = statuses
    .filter((s) => !exclude.includes(s.name))
    .map((s) => {
      let state = "no instalado";
      if (s.authenticated) state = "logado";
      else if (s.installed) state = "instalado, SIN login";
      let action = "";
      if (!s.authenticated) {
        action = s.installed || !s.install ? ` — login: ${s.login}` : ` — instalar: ${s.install}`;
      }
      const pending = s.adapterPending ? " [adaptador kj pendiente: KJC-TSK-0729]" : "";
      return `  - ${s.name} (${s.tier}) · ${state}${action}${pending}`;
    });
  return `Candidatos a reviewer:\n${lines.join("\n")}\nElige uno, haz su login y fija roles.reviewer.provider — o pasa --reviewer <nombre>.`;
}
