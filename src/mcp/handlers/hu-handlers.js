/**
 * HU and Suggest handler logic (skills moved to `atril mcp`, ADR 0021).
 * Extracted from server-handlers.js for maintainability.
 */

import { handleSuggestion } from "../suggest-handler.js";
import {
  resolveProjectDir,
  failPayload,
} from "../shared-helpers.js";

export async function handleHu(a, server) {
  const action = a.action;
  if (!action) return failPayload("Missing required field: action");

  const projectDir = await resolveProjectDir(server, a.projectDir);
  const { createManualHu, listHus, getHu, updateHuStatus } = await import("../../hu/store.js");

  switch (action) {
    case "create": {
      if (!a.title) return failPayload("Missing required field: title (required for create)");
      const hu = await createManualHu(projectDir, {
        title: a.title,
        description: a.description,
        status: a.status,
        acceptanceCriteria: a.acceptanceCriteria
      });
      return { ok: true, hu };
    }
    case "list": {
      const hus = await listHus(projectDir);
      return { ok: true, hus };
    }
    case "get": {
      if (!a.huId) return failPayload("Missing required field: huId (required for get)");
      const hu = await getHu(projectDir, a.huId);
      return { ok: true, hu };
    }
    case "update": {
      if (!a.huId) return failPayload("Missing required field: huId (required for update)");
      if (!a.status) return failPayload("Missing required field: status (required for update)");
      const hu = await updateHuStatus(projectDir, a.huId, a.status);
      return { ok: true, hu };
    }
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
