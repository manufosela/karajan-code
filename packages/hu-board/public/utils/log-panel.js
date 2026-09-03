// KJC-TSK-0501 step 7/8 — Floating run-log panel + window controls.
//
// Classic script (no exports). Loaded by index.html before app.js so
// the function declarations hoist and inline onclick="openLogViewer(...)"
// handlers emitted by board-view / dashboard-view resolve transparently.
// `logPollTimer` and `logViewerState` are top-level `let` bindings in
// this classic script — same realm as app.js, so the cross-script
// references keep working unchanged.
//
// Globals consumed from earlier scripts:
//   - esc()                       (app.js)
//   - ansiToHtml()                (utils/formatters.js)

// `logPollTimer` survives multiple sessions because the panel is a
// singleton — opening a second log tears the first one down. `panel`
// is kept on `logViewerState` so the close handler can null it out
// from inside the tail loop (without it, `tick()` would keep firing
// HTTP requests against a dead panel).
let logPollTimer = null;
let logViewerState = { planId: null, panel: null, offset: 0, isMax: false, isMin: false };

/**
 * Open (or refocus) the run-log panel for the given plan. Thin shim
 * over `openGenericLogPanel` — the original entry point used for
 * `kj run --plan` runs that the Run-plan button kicks off.
 */
function openLogViewer(planId) {
  return openGenericLogPanel({
    id: planId,
    label: 'Run log',
    tailUrl: (offset) => `/api/plans/${encodeURIComponent(planId)}/log?offset=${offset}`,
  });
}

/**
 * Generic floating log panel anchored bottom-right. Used by:
 *   - openLogViewer(planId)         → /api/plans/:planId/log
 *   - openCommandLogViewer(cmd, id) → /api/runs/:commandId/log
 *
 * The only thing that changes between callers is the tail URL +
 * the label; the window controls (min/max/close), polling, and ANSI
 * rendering are identical.
 *
 * @param {object} args
 * @param {string} args.id        - opaque id (planId or commandId), shown in header
 * @param {string} args.label     - "Run log", "kj plan", …
 * @param {(offset:number)=>string} args.tailUrl - returns the URL to GET each tick
 */
function openGenericLogPanel({ id, label, tailUrl }) {
  // Tearing down the previous panel cleanly avoids two timers running
  // when the user opens a second log while the first is still tailing.
  if (logPollTimer) { clearTimeout(logPollTimer); logPollTimer = null; }
  if (logViewerState.panel && logViewerState.panel.parentNode) {
    logViewerState.panel.remove();
  }

  const panel = document.createElement('section');
  panel.id = 'kj-log-panel';
  panel.dataset.state = 'normal';
  panel.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'width:min(720px, calc(100vw - 32px))',
    'height:min(420px, calc(100vh - 80px))',
    'display:flex',
    'flex-direction:column',
    'border:1px solid var(--border)',
    'border-radius:var(--radius-sm)',
    'background:var(--bg-secondary)',
    'box-shadow:0 12px 40px rgba(0,0,0,0.45)',
    'z-index:9999',
    'overflow:hidden',
  ].join(';');

  panel.innerHTML = `
    <header style="display:flex;align-items:center;justify-content:space-between;
                   padding:8px 12px;background:var(--bg-primary);
                   border-bottom:1px solid var(--border);
                   user-select:none;flex-shrink:0">
      <div style="display:flex;align-items:baseline;gap:10px;min-width:0">
        <strong style="color:var(--text)" title="${esc(label)}">${esc(maggleText('log.label', label))}</strong>
        <span style="font-family:var(--font-mono, monospace);font-size:0.78rem;
                     color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;
                     white-space:nowrap">${esc(id)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <span id="log-status" style="font-size:0.75rem;color:var(--text-muted);margin-right:8px">${maggleText('log.connecting', 'connecting…')}</span>
        <button id="log-min" type="button" title="Minimize (run keeps going)"
                style="${winBtnStyle('#facc15')}">_</button>
        <button id="log-max" type="button" title="Maximize / Restore"
                style="${winBtnStyle('#34d399')}">▢</button>
        <button id="log-close" type="button" title="Close panel — the run keeps going in the background. Re-open anytime via the “📜 View log” button on the board."
                style="${winBtnStyle('#f87171')}">✕</button>
      </div>
    </header>
    <pre id="log-body"
         style="margin:0;padding:12px 16px;flex:1 1 auto;overflow:auto;
                font-family:var(--font-mono, monospace);font-size:0.8rem;
                line-height:1.45;background:#0b0b0c;color:#e6e6e6;
                white-space:pre-wrap;word-break:break-word"></pre>
    <footer style="padding:6px 12px;border-top:1px solid var(--border);
                   font-size:0.7rem;color:var(--text-muted);flex-shrink:0">
      ${maggleText('log.footer', `Closing this panel does NOT stop the run. It keeps going in the background;
      reopen with the 📜 View log button on the board.`)}
    </footer>
  `;

  document.body.appendChild(panel);
  logViewerState = { planId: id, panel, offset: 0, isMax: false, isMin: false };

  const bodyEl = panel.querySelector('#log-body');
  const statusEl = panel.querySelector('#log-status');
  const footerEl = panel.querySelector('footer');
  const minBtn = panel.querySelector('#log-min');
  const maxBtn = panel.querySelector('#log-max');
  const closeBtn = panel.querySelector('#log-close');

  // ---- Window controls ----
  closeBtn.addEventListener('click', () => {
    if (logPollTimer) { clearTimeout(logPollTimer); logPollTimer = null; }
    panel.remove();
    logViewerState = { planId: null, panel: null, offset: 0, isMax: false, isMin: false };
  });

  minBtn.addEventListener('click', () => {
    logViewerState.isMin = !logViewerState.isMin;
    if (logViewerState.isMin) {
      // Collapse to header-only pill anchored at bottom-right. Polling
      // continues so the kB counter stays live; click min again to expand.
      panel.style.height = 'auto';
      panel.style.width = 'auto';
      bodyEl.style.display = 'none';
      footerEl.style.display = 'none';
      panel.dataset.state = 'min';
    } else {
      panel.style.height = logViewerState.isMax ? 'calc(100vh - 32px)' : 'min(420px, calc(100vh - 80px))';
      panel.style.width = logViewerState.isMax ? 'calc(100vw - 32px)' : 'min(720px, calc(100vw - 32px))';
      bodyEl.style.display = '';
      footerEl.style.display = '';
      panel.dataset.state = logViewerState.isMax ? 'max' : 'normal';
    }
  });

  maxBtn.addEventListener('click', () => {
    logViewerState.isMin = false;
    logViewerState.isMax = !logViewerState.isMax;
    bodyEl.style.display = '';
    footerEl.style.display = '';
    if (logViewerState.isMax) {
      panel.style.top = '16px';
      panel.style.left = '16px';
      panel.style.right = '16px';
      panel.style.bottom = '16px';
      panel.style.width = 'auto';
      panel.style.height = 'auto';
      panel.dataset.state = 'max';
    } else {
      panel.style.top = '';
      panel.style.left = '';
      panel.style.right = '16px';
      panel.style.bottom = '16px';
      panel.style.width = 'min(720px, calc(100vw - 32px))';
      panel.style.height = 'min(420px, calc(100vh - 80px))';
      panel.dataset.state = 'normal';
    }
  });

  // ---- Tail loop ----
  async function tick() {
    if (!logViewerState.panel) return;        // user closed
    try {
      const res = await fetch(tailUrl(logViewerState.offset));
      if (!res.ok) {
        statusEl.textContent = `error: HTTP ${res.status}`;
        logPollTimer = setTimeout(tick, 4000);
        return;
      }
      const body = await res.json();
      if (!body.exists) {
        statusEl.textContent = 'waiting for run to start…';
      } else {
        if (body.content) {
          // Append rendered HTML so ANSI escape codes show as colour
          // instead of literal `[1m…[0m` noise (the user's complaint).
          // Auto-scroll only when the user was already at the bottom,
          // so manual scrollback doesn't fight the tail.
          const atBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 8;
          bodyEl.insertAdjacentHTML('beforeend', ansiToHtml(body.content));
          if (atBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
        }
        logViewerState.offset = body.size;
        statusEl.textContent = `${(body.size / 1024).toFixed(1)} KB — live`;
      }
    } catch (err) {
      statusEl.textContent = `error: ${err.message}`;
    }
    logPollTimer = setTimeout(tick, 2000);
  }

  tick();
}

/** Inline style for the three window-control buttons in the log panel. */
function winBtnStyle(accentColor) {
  return [
    'width:22px',
    'height:22px',
    'padding:0',
    'border:1px solid var(--border)',
    `background:${accentColor}`,
    'color:#0b0b0c',
    'font-weight:700',
    'font-size:0.78rem',
    'line-height:20px',
    'border-radius:50%',
    'cursor:pointer',
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');
}
