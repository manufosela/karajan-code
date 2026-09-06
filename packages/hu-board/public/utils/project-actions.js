// KJC-TSK-0501 step 8b/8 — Project-level dialogs (rename + outcome).
//
// Classic script (no exports). Loaded by index.html before app.js so the
// `window.*` assignments are in place by the time the kanban mounts.
// Inline `onclick="..."` attributes (rename ✎ button in the header,
// outcome chip in board-view.js) resolve these handlers via `window`.
//
// Globals consumed from earlier scripts / app.js:
//   - esc()                       (app.js)
//   - ensureDialog()              (app.js)
//   - formatDuration()            (utils/formatters.js)
//   - projectNameCache            (mutable in app.js — assignment crosses
//                                  scripts transparently)
//   - render()                    (app.js)

/**
 * PR-G: rename a project from the header ✎ button. Opens a small
 * dialog with the current name pre-filled, validates length, PUTs
 * to /api/projects/:id/name, and re-renders the board so the new
 * name shows up everywhere (header, dropdown, picker).
 */
window.renameProjectModal = function renameProjectModal(projectId, currentName) {
  const dlg = document.getElementById('app-dialog') || ensureDialog();
  const safeCurrent = String(currentName || '').replace(/&#39;/g, "'");
  dlg.innerHTML = `
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:700;display:flex;align-items:center;gap:10px;">
      <span style="font-size:1.1rem;">✎</span>
      <span>Renombrar proyecto</span>
    </div>
    <div style="padding:14px 18px;">
      <label for="rename-input" style="display:block;font-size:0.85rem;color:var(--text);margin-bottom:6px;">
        Nombre del proyecto
      </label>
      <input type="text" id="rename-input" value="${esc(safeCurrent)}" maxlength="120"
             style="width:100%;padding:8px 10px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);font-size:0.95rem;" />
      <p style="margin:8px 0 0;font-size:0.75rem;color:var(--text-muted);">
        Se actualizará el campo <code>name</code> en cada plan JSON de este proyecto y la fila en la base de datos del board.
      </p>
      <p id="rename-error" style="margin:8px 0 0;font-size:0.78rem;color:var(--color-red,#ef4444);display:none;"></p>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="rename-cancel" style="padding:8px 16px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;">Cancelar</button>
      <button id="rename-save"   style="padding:8px 16px;background:var(--color-green);border:none;color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;">Guardar</button>
    </div>
  `;
  if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
  const input = dlg.querySelector('#rename-input');
  const errorEl = dlg.querySelector('#rename-error');
  input?.focus();
  input?.select();
  dlg.querySelector('#rename-cancel')?.addEventListener('click', () => { try { dlg.close(); } catch { /* ignore */ } }, { once: true });
  dlg.querySelector('#rename-save')?.addEventListener('click', async () => {
    const newName = input?.value?.trim() || '';
    if (!newName) { errorEl.style.display = 'block'; errorEl.textContent = 'El nombre no puede estar vacío.'; return; }
    if (newName === safeCurrent) { try { dlg.close(); } catch { /* ignore */ } return; }
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        errorEl.style.display = 'block';
        errorEl.textContent = body?.error || `HTTP ${r.status}`;
        return;
      }
      // Update the cached display name + refresh the board so the
      // header, project bar and project picker all show the new value.
      projectNameCache[projectId] = newName;
      try { dlg.close(); } catch { /* ignore */ }
      // render() (not renderBoard()) so the project bar name refreshes too.
      await render();
    } catch (err) {
      errorEl.style.display = 'block';
      errorEl.textContent = err.message || String(err);
    }
  }, { once: true });
};

/**
 * Open the outcome detail modal for a single HU. The chip on each
 * card calls this with the JSON-stringified outcome (escaped for the
 * inline onclick attribute) — we parse and render the breakdown.
 *
 * Surfaces the per-HU + plan-level execution outcome the orchestrator
 * stamps on the plan JSON. Plain Spanish, no jargon.
 */
window.showOutcomeModal = function showOutcomeModal(escapedJson) {
  let outcome;
  try { outcome = JSON.parse(String(escapedJson).replace(/&#39;/g, "'")); }
  catch { return; }
  const dlg = document.getElementById('app-dialog') || ensureDialog();
  const status = outcome.status || 'desconocido';
  const headerColor = status === 'done' ? 'var(--color-green)'
    : status === 'failed' ? 'var(--color-red,#ef4444)'
    : 'var(--color-yellow,#eab308)';
  const headerLabel = status === 'done' ? 'HU completada'
    : status === 'failed' ? 'HU fallida'
    : status === 'blocked' ? 'HU bloqueada'
    : `HU · ${status}`;
  const durationText = outcome.duration_ms != null ? formatDuration(outcome.duration_ms) : '—';
  const blockersHtml = (outcome.blockers || []).length === 0 ? '' : `
    <div style="margin-top:10px;">
      <div style="font-weight:600;color:var(--color-red,#ef4444);font-size:0.85rem;">Problemas detectados</div>
      <ul style="margin:4px 0 0 18px;padding:0;color:var(--text);">
        ${outcome.blockers.map(b => `<li style="font-size:0.8rem;margin-top:4px;">${esc(b)}</li>`).join('')}
      </ul>
    </div>
  `;
  const commitsHtml = (outcome.commits || []).length === 0 ? '' : `
    <div style="margin-top:10px;">
      <div style="font-weight:600;color:var(--text);font-size:0.85rem;">Commits</div>
      <ul style="margin:4px 0 0 18px;padding:0;color:var(--text-muted);">
        ${outcome.commits.map(c => `<li style="font-family:var(--font-mono,monospace);font-size:0.78rem;">${esc(c)}</li>`).join('')}
      </ul>
    </div>
  `;
  dlg.innerHTML = `
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:700;display:flex;align-items:center;gap:10px;background:${headerColor};color:#000;">
      <span style="font-size:1.2rem;">📄</span>
      <span>${esc(headerLabel)}</span>
    </div>
    <div style="padding:14px 18px;max-height:65vh;overflow:auto;">
      <p style="margin:0 0 10px;color:var(--text);">${esc(outcome.summary || '(sin resumen disponible)')}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:8px;font-size:0.8rem;">
        <div><strong>Iteraciones</strong>: ${outcome.iterations ?? '—'}</div>
        <div><strong>Duración</strong>: ${durationText}</div>
        <div><strong>Rama</strong>: <span style="font-family:var(--font-mono,monospace)">${esc(outcome.branch || '—')}</span></div>
        <div><strong>Pull Request</strong>: ${outcome.pr_url ? `<a href="${esc(outcome.pr_url)}" target="_blank" rel="noopener">abrir</a>` : '—'}</div>
        <div><strong>Terminada</strong>: ${esc(outcome.finishedAt || '—')}</div>
      </div>
      ${blockersHtml}
      ${commitsHtml}
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">
      <button id="outcome-close" style="padding:8px 16px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;">Cerrar</button>
    </div>
  `;
  if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
  dlg.querySelector('#outcome-close')?.addEventListener('click', () => { try { dlg.close(); } catch { /* ignore */ } }, { once: true });
};
