/**
 * HU and Suggest handler logic (skills moved to `atril mcp`, ADR 0021).
 * Extracted from server-handlers.js for maintainability.
 */

import { handleSuggestion } from "../suggest-handler.js";
import { runKjCommand } from "../run-kj.js";
import {
  resolveProjectDir,
  failPayload,
} from "../shared-helpers.js";

export const HU_STATUSES = ["pending", "running", "done", "failed", "skipped"];

/**
 * KJC-BUG-0452 (#2815): kj_hu used the old kj run store, so an agent saw an empty
 * board while `kj hu list` showed every card. It runs the CLI's own `kj hu` in a
 * subprocess: the same board (local, shared or a lane's), and stdout, which is
 * this server's protocol channel, stays clean.
 */
async function kjHu(projectDir, args) {
  const res = await runKjCommand({ command: "hu", commandArgs: [...args, "--json"], options: { projectDir } });
  if (!res.ok) return { error: `kj hu ${args[0]} failed: ${res.errorSummary || res.stderr || "no output"}` };
  const line = String(res.stdout || "").trim().split("\n").reverse().find((l) => /^[[{]/.test(l.trim()));
  try { return { data: JSON.parse(line) }; } catch { return { error: `kj hu ${args[0]} answered no JSON: ${String(res.stdout || "").slice(0, 200)}` }; }
}

const notOnBoard = (id) => `HU ${id} is not on the board — kj_hu list shows its cards`;

async function createHu(projectDir, a) {
  if (!a.title) return failPayload("Missing required field: title (required for create)");
  const args = ["add", a.title, ...(a.acceptanceCriteria ? ["--ac", a.acceptanceCriteria] : []), ...(a.ref ? ["--ref", a.ref] : [])];
  const added = await kjHu(projectDir, args);
  if (added.error) return failPayload(added.error);
  if (!a.status || a.status === "pending") return { ok: true, hu: added.data };
  return moveHu(projectDir, added.data.short_id || added.data.id, a.status);
}

async function moveHu(projectDir, huId, status) {
  if (!HU_STATUSES.includes(status)) return failPayload(`Unknown status "${status}": use ${HU_STATUSES.join(", ")}`);
  const moved = await kjHu(projectDir, ["move", huId, status]);
  return moved.error ? failPayload(moved.error) : { ok: true, hu: moved.data };
}

export async function handleHu(a, server) {
  const action = a.action;
  if (!action) return failPayload("Missing required field: action");
  const projectDir = await resolveProjectDir(server, a.projectDir);

  switch (action) {
    case "create":
      return createHu(projectDir, a);
    case "list": {
      const listed = await kjHu(projectDir, ["list"]);
      return listed.error ? failPayload(listed.error) : { ok: true, hus: listed.data };
    }
    case "get": {
      if (!a.huId) return failPayload("Missing required field: huId (required for get)");
      const listed = await kjHu(projectDir, ["list"]);
      if (listed.error) return failPayload(listed.error);
      const hu = listed.data.find((h) => h.id === a.huId || h.short_id === a.huId);
      return hu ? { ok: true, hu } : failPayload(notOnBoard(a.huId));
    }
    case "update":
      if (!a.huId) return failPayload("Missing required field: huId (required for update)");
      if (!a.status) return failPayload("Missing required field: status (required for update)");
      return moveHu(projectDir, a.huId, a.status);
    default:
      return failPayload(`Unknown hu action: ${action}`);
  }
}

export async function handleSuggest(a) {
  if (!a.suggestion) {
    return failPayload("Missing required field: suggestion");
  }
  return handleSuggestion({
    suggestion: a.suggestion,
    context: a.context || null,
    projectDir: a.projectDir || null
  });
}
