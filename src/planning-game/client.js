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

function getApiUrl() {
  return process.env.PG_API_URL || DEFAULT_API_URL;
}

export async function fetchCard({ projectId, cardId }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/cards/${encodeURIComponent(cardId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Planning Game API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.card || data;
}

export async function updateCard({ projectId, cardId, firebaseId, updates }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/cards/${encodeURIComponent(firebaseId)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates })
  });
  if (!response.ok) {
    throw new Error(`Planning Game API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
