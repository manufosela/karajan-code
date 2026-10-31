// KJC-TSK-0501 — API + polling helpers extracted from app.js (step 3/8).
// Loaded as a classic script before app.js (after modals.js) — all
// top-level declarations hoist to global scope so app.js consumes them
// transparently.
//
// Contents:
//   - api(): thin JSON fetch wrapper used everywhere in the UI.
//   - triggerSync(): POST /api/sync — fired on page load and the 🔄 button.
//   - Server-restart detector: pollServerVersion() + __versionBaseline +
//     window.forceRefresh — KJC-TSK-0379.
//
// Dependencies: `esc()` from formatters.js (already global).
// `setInterval(pollServerVersion, 30_000)` + initial call fire at the
// bottom of the file so the detector starts as soon as the script loads.

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Trigger a full re-scan of disk data (hu-stories + sessions).
 * Called on page load and via the sync button.
 */
async function triggerSync() {
  try {
    await fetch('/api/sync', { method: 'POST' });
  } catch { /* ignore — board may not support sync yet */ }
}

// --- Server-restart detector (KJC-TSK-0379) ---------------------------
// Poll /api/version every 30s. First response anchors the baseline; if
// `boot_time` later differs, the server restarted (likely after a `kj
// board start`) and the client reloads to pick up any new HTML/JS
// served with `Cache-Control: no-store`. Avoids the "I killed the
// server but the browser keeps showing stale UI" pain.
let __versionBaseline = null;
async function pollServerVersion() {
  try {
    const res = await api('/version');
    if (!__versionBaseline) { __versionBaseline = res; return; }
    if (res.boot_time !== __versionBaseline.boot_time) {
      console.info('[hu-board] server restart detected, reloading...');
      window.forceRefresh();
    }
  } catch (_) { /* network blip; try next tick */ }
}
setInterval(pollServerVersion, 30_000);
pollServerVersion();

// Manual escape hatch: bound to the 🔄 button in the header. Wipes all
// caches the browser may be holding (Cache API + sessionStorage) and
// hard-reloads. Useful when the user thinks something is wrong even
// though the version-poll hasn't fired.
window.forceRefresh = async function forceRefresh() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    sessionStorage.clear();
  } catch (_) { /* best effort */ }
  window.location.reload();
};
