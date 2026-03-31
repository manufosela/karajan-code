/**
 * Shared helpers used by MCP handler sub-modules.
 * Extracted from server-handlers.js to break circular import chains
 * (server-handlers.js ↔ handlers/*.js).
 *
 * Sub-handlers MUST import from here, NOT from server-handlers.js.
 * server-handlers.js re-exports everything for external consumers.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { loadConfig, applyRunOverrides, validateConfig } from "../config.js";
import { currentBranch } from "../utils/git.js";
import { buildProgressNotifier } from "./progress.js";
import { compressResponse, compactStringify } from "./response-compressor.js";
import { classifyError } from "./error-classifiers.js";

export { classifyError } from "./error-classifiers.js";

/**
 * Resolve the user's project directory.
 * Priority: 1) explicit projectDir param, 2) MCP roots, 3) error with instructions.
 */
export async function resolveProjectDir(server, explicitProjectDir) {
  if (explicitProjectDir) return explicitProjectDir;

  try {
    const { roots } = await server.listRoots();
    if (roots?.length > 0) {
      const uri = roots[0].uri;
      if (uri.startsWith("file://")) return new URL(uri).pathname;
      return uri;
    }
  } catch { /* client may not support roots */ }

  const cwd = process.cwd();
  try {
    const hasGit = await fs.access(`${cwd}/.git`).then(() => true).catch(() => false);
    const hasPkg = await fs.access(`${cwd}/package.json`).then(() => true).catch(() => false);
    if (hasGit || hasPkg) return cwd;
  } catch { /* ignore */ }

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

export async function assertNotOnBaseBranch(config) {
  const baseBranch = config?.base_branch || "main";
  let branch;
  try {
    branch = await currentBranch();
  } catch {
    return;
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
    } catch {
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
