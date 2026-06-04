// KJC-TSK-0501 step 7/8 — Preflight panel (compact run-readiness banner).
//
// Classic script (no exports). Loaded by index.html before app.js so
// the function hoists into the script-level lexical environment and
// app.js (handleRoute → kanban view) can call renderPreflightPanel().
//
// The companion helpers fetchPreflight(), preflightStatusIcon(),
// preflightStatusColor() and the mutable `preflightCache` are kept in
// app.js because the confirmRunWithPreflight() modal also reads them;
// extracting both would force a forward-reference dance we don't need
// at this stage.
//
// Globals consumed from earlier scripts / app.js:
//   - esc()                       (app.js)
//   - fetchPreflight()            (app.js)
//   - preflightStatusIcon()       (app.js)
//   - preflightStatusColor()      (app.js)
//   - preflightCache              (mutable, app.js — we assign to it)

/**
 * Render the compact preflight banner above the kanban. Shows a single
 * summary chip (ok / warn / fail) plus a click-to-expand grid of every
 * deterministic check the backend ran. No-op if the panel slot isn't
 * in the DOM yet (the kanban hasn't mounted).
 */
async function renderPreflightPanel(projectId) {
  const panel = document.getElementById('preflight-panel');
  if (!panel) return;
  const data = await fetchPreflight(projectId);
  preflightCache = data;
  if (!data) {
    panel.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);padding:6px 10px;">Estado del proyecto: no disponible.</div>`;
    return;
  }
  const blockerCount = data.blockers?.length || 0;
  const warningCount = data.warnings?.length || 0;
  const okCount = (data.checks || []).filter(c => c.status === 'ok').length;
  let summaryColor, summaryIcon, summaryText;
  if (blockerCount > 0) {
    summaryColor = 'var(--color-red,#ef4444)';
    summaryIcon = '✗';
    summaryText = `${blockerCount} problema(s) bloqueante(s) — la ejecución no funcionará correctamente`;
  } else if (warningCount > 0) {
    summaryColor = 'var(--color-yellow,#eab308)';
    summaryIcon = '⚠';
    summaryText = `${warningCount} aviso(s) — la ejecución funcionará pero con limitaciones`;
  } else {
    summaryColor = 'var(--color-green)';
    summaryIcon = '✓';
    summaryText = `Todo listo · ${okCount} comprobaciones OK`;
  }

  // Compact header (always visible) + collapsed details (toggleable).
  panel.innerHTML = `
    <div class="preflight-panel__header"
         style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-primary);border:1px solid var(--border);border-left:3px solid ${summaryColor};border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem;"
         data-toggle>
      <span style="color:${summaryColor};font-weight:700;font-size:1rem;">${summaryIcon}</span>
      <span style="color:var(--text);">${esc(summaryText)}</span>
      <span style="margin-left:auto;color:var(--text-muted);font-size:0.78rem;" data-arrow>▼ ver detalles</span>
    </div>
    <div class="preflight-panel__details" style="display:none;margin-top:6px;padding:10px 12px;background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-sm);">
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:8px;">
        ${(data.checks || []).map((c) => `
          <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;background:var(--bg-secondary,var(--bg));border-radius:var(--radius-sm);"
               title="${esc(c.consequence || '')}">
            <span style="color:${preflightStatusColor(c.status)};font-weight:700;font-size:0.95rem;flex-shrink:0;">${preflightStatusIcon(c.status)}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.8rem;font-weight:600;color:var(--text);">${esc(c.label)}</div>
              <div style="font-size:0.72rem;color:var(--text-muted);word-break:break-all;">${esc(c.detail || '')}</div>
              ${c.consequence ? `<div style="font-size:0.7rem;color:${preflightStatusColor(c.status)};margin-top:2px;">${esc(c.consequence)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  // Toggle expand/collapse without rerender.
  const header = panel.querySelector('[data-toggle]');
  const details = panel.querySelector('.preflight-panel__details');
  const arrow = panel.querySelector('[data-arrow]');
  if (header && details && arrow) {
    header.addEventListener('click', () => {
      const open = details.style.display !== 'none';
      details.style.display = open ? 'none' : 'block';
      arrow.textContent = open ? '▼ ver detalles' : '▲ ocultar detalles';
    });
  }
}
