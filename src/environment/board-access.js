/**
 * Board access verification (KJC-TSK-0685). User rule: Karajan does not
 * run without a board — it is what guarantees ordered, card-first work and
 * meaningful lanes. There is NO "none". init/env-install verify an
 * OPERATIONAL access path to the declared backend:
 *   - hu-board       → always ok (ships inside the kj tarball).
 *   - planning-game  → its MCP appears in a host agent config.
 *   - external       → the named board's MCP appears in a host agent
 *                      config, OR an API token is exported (conventional
 *                      env var, or the one declared in board.token_env).
 * Detection is presence-based and format-agnostic (the MCP config files
 * are scanned as text) — v1 verifies a path exists, not connectivity.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TOKEN_CONVENTIONS = {
  linear: ["LINEAR_API_KEY"],
  trello: ["TRELLO_TOKEN", "TRELLO_API_KEY"],
  jira: ["JIRA_API_TOKEN"],
  github: ["GITHUB_TOKEN", "GH_TOKEN"],
  asana: ["ASANA_ACCESS_TOKEN"],
};

function mcpConfigPaths(projectDir, home) {
  return [
    path.join(projectDir, ".mcp.json"),
    path.join(home, ".claude.json"),
    path.join(home, ".codex", "config.toml"),
    path.join(home, ".gemini", "settings.json"),
  ];
}

function mcpConfigsMention(slug, projectDir, home) {
  const needle = slug.toLowerCase();
  for (const p of mcpConfigPaths(projectDir, home)) {
    try {
      if (existsSync(p) && readFileSync(p, "utf8").toLowerCase().includes(needle)) return p;
    } catch { /* unreadable config — keep looking */ }
  }
  return null;
}

export function verifyBoardAccess({ config = {}, projectDir = process.cwd(), env = process.env, home = os.homedir() } = {}) {
  const backend = config.state_backend || "hu-board";

  if (backend === "planning-game") {
    const hit = mcpConfigsMention("planning-game", projectDir, home);
    if (hit) return { ok: true, backend, via: `planning-game MCP (${hit})` };
    return {
      ok: false, backend,
      needed: ["configure the planning-game MCP in your host agent (project .mcp.json or the agent's global config)"],
    };
  }

  if (backend === "external") {
    const name = String(config.board?.name || "").trim();
    if (!name) return { ok: false, backend, needed: ["declare board.name in kj.config.yml (e.g. Linear, Trello, Jira, GitHub Issues)"] };
    const slug = name.toLowerCase().split(/\s+/)[0];
    const hit = mcpConfigsMention(slug, projectDir, home);
    if (hit) return { ok: true, backend, via: `${name} MCP detected (${hit})` };
    const tokenEnvs = config.board?.token_env ? [config.board.token_env] : (TOKEN_CONVENTIONS[slug] || []);
    const found = tokenEnvs.find((k) => env[k]);
    if (found) return { ok: true, backend, via: `API token ${found}` };
    return {
      ok: false, backend, name,
      needed: [
        `configure the ${name} MCP in your host agent (project .mcp.json or the agent's global config), or`,
        tokenEnvs.length > 0
          ? `export an API token: ${tokenEnvs.join(" or ")}`
          : "declare board.token_env in kj.config.yml and export that variable",
      ],
    };
  }

  return { ok: true, backend: "hu-board", via: "bundled HU Board" };
}
