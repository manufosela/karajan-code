/**
 * MCP server handler logic.
 * Shared helpers remain here; handler implementations are in ./handlers/*.
 * Re-exports everything so existing imports continue to work.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { loadConfig, applyRunOverrides, validateConfig } from "../config.js";
import { currentBranch } from "../utils/git.js";
import { buildProgressNotifier } from "./progress.js";
import { compressResponse, compactStringify } from "./response-compressor.js";
import { withDocLink } from "../utils/doc-links.js";

// ── Sub-module re-exports ────────────────────────────────────────────
export { handleRunDirect, handleResumeDirect, validateResumeAnswer, handleRun, handleResume } from "./handlers/run-handler.js";
export { handlePlanDirect, handleCodeDirect, handleReviewDirect, handleDiscoverDirect, handleTriageDirect, handleResearcherDirect, handleAuditDirect, handleArchitectDirect, handleCode, handleReview, handlePlan, handleDiscover, handleTriage, handleResearcher, handleArchitect, handleAudit } from "./handlers/direct-handlers.js";
export { handleStatus, handleAgents, handlePreflight, handleRoles, handleReport, handleInit, handleDoctor, handleConfig, handleScan, handleBoard, handleUndo, buildPreflightRequiredResponse } from "./handlers/management-handlers.js";
export { handleHu, handleSkills, handleSuggest } from "./handlers/hu-handlers.js";

// ── Shared helpers (used by sub-modules and external consumers) ──────

/**
 * Resolve the user's project directory.
 * Priority: 1) explicit projectDir param, 2) MCP roots, 3) error with instructions.
 */
export async function resolveProjectDir(server, explicitProjectDir) {
  // 1. Explicit projectDir from tool parameter — always wins
  if (explicitProjectDir) return explicitProjectDir;

  // 2. MCP roots (host-provided workspace directory)
  try {
    const { roots } = await server.listRoots();
    if (roots?.length > 0) {
      const uri = roots[0].uri;
      if (uri.startsWith("file://")) return new URL(uri).pathname;
      return uri;
    }
  } catch { /* client may not support roots */ }

  // 3. Check if process.cwd() looks like a real project (has package.json or .git)
  const cwd = process.cwd();
  try {
    const hasGit = await fs.access(`${cwd}/.git`).then(() => true).catch(() => false);
    const hasPkg = await fs.access(`${cwd}/package.json`).then(() => true).catch(() => false);
    if (hasGit || hasPkg) return cwd;
  } catch { /* ignore */ }

  // 4. No valid project directory — fail with clear instructions
  throw new Error(
    `Cannot determine project directory. The MCP server is running from "${cwd}" which does not appear to be your project. ` +
    `Fix: pass the "projectDir" parameter with the absolute path to your project (e.g., projectDir: "/home/user/my-project"), ` +
    `or run "kj init" inside your project directory.`
  );
}

export function asObject(value) {
  if (value && typeof value === "object") return value;
  return {};
}

export function responseText(payload) {
  const compressed = compressResponse(payload);
  return {
    content: [{ type: "text", text: compactStringify(compressed) }]
  };
}

export function failPayload(message, details = {}) {
  return {
    ok: false,
    error: message,
    ...details
  };
}

const ERROR_CLASSIFIERS = [
  {
    test: (lower) => lower.includes("without output") || lower.includes("silent for") || lower.includes("unresponsive") || lower.includes("exceeded max silence"),
    category: "agent_stall",
    suggestion: "Agent output stalled. Check live details with kj_status, then retry with a smaller prompt or increase session.max_agent_silence_minutes if needed."
  },
  {
    test: (lower) => lower.includes("sonar") && (lower.includes("connect") || lower.includes("econnrefused") || lower.includes("not available") || lower.includes("not running")),
    category: "sonar_unavailable",
    suggestion: withDocLink("SonarQube is not reachable. Try: kj_init to set up SonarQube, or run 'docker start sonarqube' if already installed. Use --no-sonar to skip SonarQube.", "sonar_docker")
  },
  {
    test: (lower) => lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid token"),
    category: "auth_error",
    suggestion: withDocLink("Authentication failed. Regenerate the SonarQube token and update it via kj_init or in ~/.karajan/kj.config.yml under sonarqube.token.", "sonar_token")
  },
  {
    test: (lower) => lower.includes("config") && (lower.includes("missing") || lower.includes("not found") || lower.includes("invalid")),
    category: "config_error",
    suggestion: withDocLink("Configuration issue detected. Run kj_doctor to diagnose, or kj_init to create a fresh config.", "config_missing")
  },
  {
    test: (lower) => lower.includes("missing provider") || lower.includes("not found") && (lower.includes("claude") || lower.includes("codex") || lower.includes("gemini") || lower.includes("aider")),
    category: "agent_missing",
    suggestion: withDocLink("Required agent CLI not found. Run kj_doctor to check which agents are installed and get installation instructions.", "agent_not_found")
  },
  {
    test: (lower) => lower.includes("timed out") || lower.includes("timeout"),
    category: "timeout",
    suggestion: "The agent did not complete in time. Try: (1) increase --max-iteration-minutes (default: 5), (2) split the task into smaller pieces, (3) use kj_code for single-agent tasks. If a SonarQube scan timed out, check Docker health."
  },
  {
    test: (lower) => lower.includes("you are on the base branch"),
    category: "branch_error",
    suggestion: withDocLink("Create a feature branch before running Karajan. Use 'git checkout -b feat/<task-description>' and then retry. Do NOT run kj_code directly on the base branch.", "branch_error")
  },
  {
    test: (lower) => lower.includes("not a git repository"),
    category: "git_error",
    suggestion: "Current directory is not a git repository. Navigate to your project root or initialize git with 'git init'."
  },
  {
    test: (lower) => lower.includes("bootstrap failed"),
    category: "bootstrap_error",
    suggestion: withDocLink("Environment prerequisites not met. Run kj_doctor for diagnostics, then fix the issues listed. Do NOT work around these — fix them properly.", "bootstrap_failed")
  }
];

export function classifyError(error) {
  const msg = error?.message || String(error);
  const lower = msg.toLowerCase();

  const match = ERROR_CLASSIFIERS.find(c => c.test(lower));
  if (match) {
    return { category: match.category, suggestion: match.suggestion };
  }
  return { category: "unknown", suggestion: null };
}

export async function assertNotOnBaseBranch(config) {
  const baseBranch = config?.base_branch || "main";
  let branch;
  try {
    branch = await currentBranch();
  } catch {
    return; // not a git repo or detached HEAD — let downstream handle it
  }
  if (branch === baseBranch) {
    throw new Error(
      `You are on the base branch '${baseBranch}'. Karajan needs a feature branch to compute the diff for review. ` +
      `Create a new branch first (e.g. 'git checkout -b feat/<task-description>') and then run this command again. ` +
      `Do NOT run kj_code directly — create the branch first so the full pipeline (code + review) works correctly.`
    );
  }
}

export function enrichedFailPayload(error, toolName) {
  const msg = error?.message || String(error);
  const { category, suggestion } = classifyError(error);
  const payload = {
    ok: false,
    error: msg,
    tool: toolName,
    category
  };
  if (suggestion) payload.suggestion = suggestion;
  return payload;
}

export async function buildConfig(options, commandName = "run") {
  const { config } = await loadConfig();
  const merged = applyRunOverrides(config, options || {});
  validateConfig(merged, commandName);
  return merged;
}

export function buildAskQuestion(server) {
  return async (question) => {
    try {
      const result = await server.elicitInput({
        message: question,
        requestedSchema: {
          type: "object",
          properties: {
            answer: { type: "string", description: "Your response" }
          },
          required: ["answer"]
        }
      });
      return result.action === "accept" ? result.content?.answer || null : null;
    } catch { /* elicitInput not supported by client */
      return null;
    }
  };
}

const EVENT_LOG_LEVELS = {
  "agent:stall": "warning",
  "agent:heartbeat": "info"
};

export function buildDirectEmitter(server, runLog, extra) {
  const emitter = new EventEmitter();
  emitter.on("progress", (event) => {
    try {
      const level = EVENT_LOG_LEVELS[event.type] || "debug";
      server.sendLoggingMessage({ level, logger: "karajan", data: event });
    } catch { /* best-effort */ }
    if (runLog) runLog.logEvent(event);
  });
  const progressNotifier = buildProgressNotifier(extra);
  if (progressNotifier) emitter.on("progress", progressNotifier);
  return emitter;
}

// ── Handler dispatch map (imports from sub-modules) ──────────────────

import { handleRun, handleResume } from "./handlers/run-handler.js";
import {
  handleCode, handleReview, handlePlan, handleDiscover,
  handleTriage, handleResearcher, handleArchitect, handleAudit
} from "./handlers/direct-handlers.js";
import {
  handleStatus, handleAgents, handlePreflight, handleRoles,
  handleReport, handleInit, handleDoctor, handleConfig,
  handleScan, handleBoard, handleUndo
} from "./handlers/management-handlers.js";
import { handleHu, handleSkills, handleSuggest } from "./handlers/hu-handlers.js";

const toolHandlers = {
  kj_status:      (a, server) => handleStatus(a, server),
  kj_init:        (a) => handleInit(a),
  kj_doctor:      (a) => handleDoctor(a),
  kj_agents:      (a) => handleAgents(a),
  kj_preflight:   (a) => handlePreflight(a),
  kj_config:      (a) => handleConfig(a),
  kj_scan:        (a, server) => handleScan(a, server),
  kj_roles:       (a) => handleRoles(a),
  kj_report:      (a) => handleReport(a),
  kj_resume:      (a, server, extra) => handleResume(a, server, extra),
  kj_run:         (a, server, extra) => handleRun(a, server, extra),
  kj_code:        (a, server, extra) => handleCode(a, server, extra),
  kj_review:      (a, server, extra) => handleReview(a, server, extra),
  kj_plan:        (a, server, extra) => handlePlan(a, server, extra),
  kj_discover:    (a, server, extra) => handleDiscover(a, server, extra),
  kj_triage:      (a, server, extra) => handleTriage(a, server, extra),
  kj_researcher:  (a, server, extra) => handleResearcher(a, server, extra),
  kj_architect:   (a, server, extra) => handleArchitect(a, server, extra),
  kj_audit:       (a, server, extra) => handleAudit(a, server, extra),
  kj_board:       (a) => handleBoard(a),
  kj_hu:          (a, server) => handleHu(a, server),
  kj_suggest:     (a) => handleSuggest(a),
  kj_skills:      (a) => handleSkills(a),
  kj_undo:        (a, server) => handleUndo(a, server)
};

export async function handleToolCall(name, args, server, extra) {
  const a = asObject(args);
  const handler = toolHandlers[name];
  if (handler) {
    return handler(a, server, extra);
  }
  return failPayload(`Unknown tool: ${name}`);
}
