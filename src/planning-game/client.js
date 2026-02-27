/**
 * Planning Game MCP client.
 * Communicates with Planning Game via HTTP API or MCP tool calls.
 *
 * When Karajan runs as an MCP server (kj_run), the caller (Claude Code)
 * is expected to provide card data directly via pgTask/pgProject flags.
 *
 * This client provides standalone HTTP access for CLI usage (kj run --pg-task).
 * Requires planning_game.api_url in config or PG_API_URL env var.
 */

const DEFAULT_API_URL = "http://localhost:3000/api";
const DEFAULT_TIMEOUT_MS = 10000;

function getApiUrl() {
  return process.env.PG_API_URL || DEFAULT_API_URL;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Planning Game API timeout after ${timeoutMs}ms`);
    }
    throw new Error(`Planning Game network error: ${error?.message || "unknown error"}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Planning Game invalid response: ${error?.message || "invalid JSON"}`);
  }
}

export async function fetchCard({ projectId, cardId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/cards/${encodeURIComponent(cardId)}`;
  const response = await fetchWithTimeout(url, {}, timeoutMs);
  if (!response.ok) {
    throw new Error(`Planning Game API error: ${response.status} ${response.statusText}`);
  }
  const data = await parseJsonResponse(response);
  return data?.card || data;
}

export async function getCard({ projectId, cardId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return fetchCard({ projectId, cardId, timeoutMs });
}

export async function listCards({ projectId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/cards`;
  const response = await fetchWithTimeout(url, {}, timeoutMs);
  if (!response.ok) {
    throw new Error(`Planning Game API error: ${response.status} ${response.statusText}`);
  }
  const data = await parseJsonResponse(response);
  return data?.cards || data;
}

export async function updateCard({ projectId, cardId, firebaseId, updates, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/cards/${encodeURIComponent(firebaseId)}`;
  const response = await fetchWithTimeout(
    url,
    {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates })
    },
    timeoutMs
  );
  if (!response.ok) {
    throw new Error(`Planning Game API error: ${response.status} ${response.statusText}`);
  }
  return parseJsonResponse(response);
}
