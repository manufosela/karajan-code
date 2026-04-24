/**
 * MCP-scoped preflight state (handshake flag + session overrides facade).
 *
 * Two pieces of state:
 *   - `preflightAcked`: whether the user/host has completed the
 *     `kj_preflight` handshake in the current MCP session. Stays local
 *     because it is strictly MCP-protocol state (no CLI equivalent).
 *   - Session overrides: since v2.7.5 these live in
 *     `src/session/runtime-overrides.js` — a neutral module that both
 *     CLI commands and MCP handlers can depend on without creating a
 *     layer violation. This file re-exports the same functions under
 *     their historical names for back-compat with existing MCP handlers.
 *
 * CLI code must NOT import from this file — it should go straight to
 * `src/session/runtime-overrides.js`. Enforced by
 * `tests/architecture/layer-boundaries.test.js`.
 */

import {
  getRuntimeOverrides,
  setRuntimeOverride,
  clearRuntimeOverrides,
} from "../session/runtime-overrides.js";

let preflightAcked = false;

export function isPreflightAcked() {
  return preflightAcked;
}

export function ackPreflight(overrides = {}) {
  preflightAcked = true;
  clearRuntimeOverrides();
  for (const [k, v] of Object.entries(overrides || {})) {
    setRuntimeOverride(k, v);
  }
}

export function resetPreflight() {
  preflightAcked = false;
  clearRuntimeOverrides();
}

// Back-compat aliases for MCP handlers that still import these names.
// New code should import from `src/session/runtime-overrides.js` directly.
export const getSessionOverrides = getRuntimeOverrides;
export const setSessionOverride = setRuntimeOverride;
