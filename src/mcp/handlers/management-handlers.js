/**
 * Management handler logic (init, doctor, config, scan, report, roles, agents, preflight, status, board).
 * Extracted from server-handlers.js for maintainability.
 */

import { runKjCommand } from "../run-kj.js";
import { loadConfig } from "../../config.js";
import { readRunLog } from "../../utils/run-log.js";
import { isPreflightAcked, ackPreflight, getSessionOverrides } from "../preflight.js";
import { ensureBootstrap } from "../../bootstrap.js";
import {
  resolveProjectDir,
  failPayload,
  responseText,
  buildConfig,
} from "../server-handlers.js";

const AGENT_ROLES = new Set(["coder", "reviewer", "tester", "security", "solomon"]);

/**
 * Run bootstrap gate: validate all environment prerequisites before execution.
 */
async function runBootstrapGate(server, a) {
  const projectDir = await resolveProjectDir(server, a.projectDir);
  const { config } = await loadConfig(projectDir);
  await ensureBootstrap(projectDir, config);
}

export async function handleStatus(a, server) {
  const maxLines = a.lines || 50;
  const projectDir = await resolveProjectDir(server, a.projectDir);
  return readRunLog(projectDir, maxLines);
}

export async function handleAgents(a) {
  const action = a.action || "list";
  if (action === "set") {
    if (!a.role || !a.provider) {
      return failPayload("Missing required fields: role and provider");
    }
    const { setAgent } = await import("../../commands/agents.js");
    const result = await setAgent(a.role, a.provider, { global: false });
    return { ok: true, ...result, message: `${result.role} now uses ${result.provider} (scope: ${result.scope})` };
  }
  const config = await buildConfig(a);
  const { listAgents } = await import("../../commands/agents.js");
  const sessionOvr = getSessionOverrides();
  return { ok: true, agents: listAgents(config, sessionOvr) };
}

function parseHumanResponseOverrides(humanResponse, overrides) {
  for (const role of AGENT_ROLES) {
    const patterns = [
      new RegExp(String.raw`use\s+(\w+)\s+(?:as|for)\s+${role}`, "i"),
      new RegExp(String.raw`${role}\s*[:=]\s*(\w+)`, "i"),
      new RegExp(String.raw`set\s+${role}\s+(?:to|=)\s*(\w+)`, "i")
    ];
    for (const pat of patterns) {
      const m = pat.exec(humanResponse);
      if (m && !overrides[role]) {
        overrides[role] = m[1];
        break;
      }
    }
  }
}

function buildPreflightOverrides(a) {
  const overrides = {};
  for (const role of AGENT_ROLES) {
    if (a[role]) overrides[role] = a[role];
  }
  if (a.enableTester !== undefined) overrides.enableTester = a.enableTester;
  if (a.enableSecurity !== undefined) overrides.enableSecurity = a.enableSecurity;

  const resp = (a.humanResponse || "").toLowerCase();
  if (resp !== "ok") {
    parseHumanResponseOverrides(a.humanResponse || "", overrides);
  }
  return overrides;
}

function formatPreflightConfig(agents, overrides) {
  const lines = agents
    .filter(ag => ag.provider !== "-")
    .map(ag => {
      const ovr = overrides[ag.role] ? ` -> ${overrides[ag.role]} (session override)` : "";
      const modelSuffix = ag.model === "-" ? "" : ` (${ag.model})`;
      return `  ${ag.role}: ${ag.provider}${modelSuffix}${ovr}`;
    });
  const overrideLines = Object.entries(overrides)
    .filter(([k]) => !AGENT_ROLES.has(k))
    .map(([k, v]) => `  ${k}: ${v}`);
  return [...lines, ...overrideLines].join("\n");
}

export async function handlePreflight(a) {
  const overrides = buildPreflightOverrides(a);
  ackPreflight(overrides);

  const config = await buildConfig(a);
  const { listAgents } = await import("../../commands/agents.js");
  const agents = listAgents(config);

  return {
    ok: true,
    message: `Preflight acknowledged. Agent configuration confirmed.`,
    config: formatPreflightConfig(agents, overrides),
    overrides
  };
}

export function handleRoles(a) {
  const action = a.action || "list";
  const commandArgs = [action];
  if (action === "show" && a.roleName) commandArgs.push(a.roleName);
  return runKjCommand({ command: "roles", commandArgs, options: a });
}

function buildReportArgs(a) {
  const commandArgs = [];
  if (a.list) commandArgs.push("--list");
  if (a.sessionId) commandArgs.push("--session-id", String(a.sessionId));
  if (a.format) commandArgs.push("--format", String(a.format));
  if (a.trace) commandArgs.push("--trace");
  if (a.currency) commandArgs.push("--currency", String(a.currency));
  if (a.pgTask) commandArgs.push("--pg-task", String(a.pgTask));
  return commandArgs;
}

export function handleReport(a) {
  return runKjCommand({ command: "report", commandArgs: buildReportArgs(a), options: a });
}

export function handleInit(a) {
  return runKjCommand({ command: "init", options: a });
}

export function handleDoctor(a) {
  return runKjCommand({ command: "doctor", options: a });
}

export function handleConfig(a) {
  return runKjCommand({ command: "config", commandArgs: a.json ? ["--json"] : [], options: a });
}

export async function handleScan(a, server) {
  await runBootstrapGate(server, a);
  return runKjCommand({ command: "scan", options: a });
}

export async function handleBoard(a) {
  const action = a.action || "status";
  const { loadConfig: lc } = await import("../../config.js");
  const { config } = await lc();
  const port = a.port || config.hu_board?.port || 4000;
  const { startBoard, stopBoard, boardStatus } = await import("../../commands/board.js");
  switch (action) {
    case "start": return startBoard(port);
    case "stop": return stopBoard();
    case "status": return boardStatus(port);
    default: return failPayload(`Unknown board action: ${action}`);
  }
}

export async function buildPreflightRequiredResponse(toolName) {
  const { config } = await loadConfig();
  const { listAgents } = await import("../../commands/agents.js");
  const agents = listAgents(config);
  const agentSummary = agents
    .filter(ag => ag.provider !== "-")
    .map(ag => {
      const modelSuffix = ag.model === "-" ? "" : ` (${ag.model})`;
      return `  ${ag.role}: ${ag.provider}${modelSuffix}`;
    })
    .join("\n");
  return responseText({
    ok: false,
    preflightRequired: true,
    message: `PREFLIGHT REQUIRED\n\nCurrent agent configuration:\n${agentSummary}\n\nAsk the human to confirm or adjust this configuration, then call kj_preflight with their response.\n\nDo NOT pass coder/reviewer parameters to ${toolName} — use kj_preflight to set them.`
  });
}
