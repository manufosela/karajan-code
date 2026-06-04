// KJC-TSK-0501 — API + polling helpers extracted from app.js (step 3/8).
// Loaded as a classic script before app.js (after modals.js) — all
// top-level declarations hoist to global scope so app.js consumes them
// transparently.
//
// Contents:
//   - api(): thin JSON fetch wrapper used everywhere in the UI.
//   - triggerSync(): POST /api/sync — fired on page load and the 🔄 button.
//   - Standby banner: _standbyData state + refreshStandby() +
//     _renderStandbyBanner() + _tickStandbyCountdowns() +
//     startStandbyPolling() — KJC-TSK-0414 PR4.
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

// KJC-TSK-0414 PR4: standby banner — sesiones hibernadas pendientes de resume.
// Polleamos /api/standby cada 30s + tick countdown cada 1s.
let _standbyData = { sessions: [] };
let _standbyPollTimer = null;
let _standbyTickTimer = null;

function _fmtCountdown(ms) {
  if (ms <= 0) return '✓ resume inmediato';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

async function refreshStandby() {
  try {
    const r = await api('/api/standby');
    _standbyData = r || { sessions: [] };
    _renderStandbyBanner();
  } catch { /* silencioso — endpoint nuevo, podría no existir en versiones viejas */ }
}

function _renderStandbyBanner() {
  let banner = document.getElementById('standby-banner');
  const sessions = _standbyData.sessions || [];
  if (sessions.length === 0) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'standby-banner';
    banner.style.cssText = 'background:rgba(251,191,36,0.12);border-left:4px solid #fbbf24;padding:10px 16px;margin:0 0 12px;font-size:0.85rem';
    const app = document.getElementById('app');
    if (app?.parentNode) app.parentNode.insertBefore(banner, app);
  }
  const now = Date.now();
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <strong>💤 ${sessions.length} sesión(es) hibernadas:</strong>
      ${sessions.map((s) => {
        const ms = new Date(s.cooldownUntil).getTime() - now;
        const label = _fmtCountdown(ms);
        const reason = s.reason || '?';
        const planInfo = s.planId ? ` · ${s.planId}${s.huId ? '/' + s.huId : ''}` : '';
        return `<span data-session="${esc(s.sessionId)}" data-cooldown="${esc(s.cooldownUntil)}" style="background:rgba(0,0,0,0.15);padding:4px 8px;border-radius:4px;font-family:monospace" title="${esc(reason)}${esc(planInfo)}">${esc(s.sessionId)} · <span class="standby-countdown">${label}</span></span>`;
      }).join('')}
      <span style="margin-left:auto;color:var(--text-muted);font-size:0.75rem">Auto-resume al llegar el cooldown (board) o <code>kj resume &lt;id&gt;</code></span>
    </div>
  `;
}

function _tickStandbyCountdowns() {
  const banner = document.getElementById('standby-banner');
  if (!banner) return;
  const now = Date.now();
  for (const chip of banner.querySelectorAll('[data-cooldown]')) {
    const target = new Date(chip.getAttribute('data-cooldown')).getTime();
    const span = chip.querySelector('.standby-countdown');
    if (span) span.textContent = _fmtCountdown(target - now);
  }
}

function startStandbyPolling() {
  if (_standbyPollTimer || _standbyTickTimer) return;
  refreshStandby();
  _standbyPollTimer = setInterval(refreshStandby, 30_000);
  _standbyTickTimer = setInterval(_tickStandbyCountdowns, 1000);
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
