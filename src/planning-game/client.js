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

import { withRetry } from "../utils/retry.js";

const DEFAULT_API_URL = "http://localhost:3000/api";
const DEFAULT_TIMEOUT_MS = 10000;

function getApiUrl() {
  return process.env.PG_API_URL || DEFAULT_API_URL;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const err = new Error(`Planning Game API error: ${response.status} ${response.statusText}`);
      err.httpStatus = response.status;
      err.retryAfter = response.headers?.get?.("retry-after") || null;
      throw err;
    }
    return response;
  } catch (error) {
    if (error?.httpStatus) throw error;
    if (error?.name === "AbortError") {
      const err = new Error(`Planning Game API timeout after ${timeoutMs}ms`);
      err.httpStatus = 408;
      throw err;
    }
    throw new Error(`Planning Game network error: ${error?.message || "unknown error"}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS, retryOpts = {}) {
  return withRetry(
    () => fetchWithTimeout(url, options, timeoutMs),
    { maxAttempts: 3, initialBackoffMs: 1000, ...retryOpts }
  );
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
  const response = await fetchWithRetry(url, {}, timeoutMs);
  const data = await parseJsonResponse(response);
  return data?.card || data;
}

async function getCard({ projectId, cardId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return fetchCard({ projectId, cardId, timeoutMs });
}

async function listCards({ projectId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/cards`;
  const response = await fetchWithRetry(url, {}, timeoutMs);
  const data = await parseJsonResponse(response);
  return data?.cards || data;
}

export async function updateCard({ projectId, cardId, firebaseId, updates, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/cards/${encodeURIComponent(firebaseId)}`;
  const response = await fetchWithRetry(
    url,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates })
    },
    timeoutMs
  );
  return parseJsonResponse(response);
}

export async function createCard({ projectId, card, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/cards`;
  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card)
    },
    timeoutMs
  );
  return parseJsonResponse(response);
}

export async function createAdr({ projectId, adr, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/adrs`;
  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adr)
    },
    timeoutMs
  );
  return parseJsonResponse(response);
}

export async function relateCards({ projectId, sourceCardId, targetCardId, relationType, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${getApiUrl()}/projects/${encodeURIComponent(projectId)}/cards/relate`;
  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceCardId, targetCardId, relationType })
    },
    timeoutMs
  );
  return parseJsonResponse(response);
}
