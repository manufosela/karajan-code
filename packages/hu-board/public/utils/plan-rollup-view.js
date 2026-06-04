// KJC-TSK-0501 step 7/8 — Plan rollup banner (post-run summary).
//
// Classic script (no exports). Loaded by index.html before app.js so
// the function hoists into the script-level lexical environment and
// app.js (handleRoute → kanban view) can call renderPlanRollup().
//
// Globals consumed from earlier scripts / app.js:
//   - esc()                       (app.js)
//   - formatDuration()            (utils/formatters.js)

/**
 * Compact "what just happened" banner shown above the kanban when the
 * most recently finished plan has an outcome. Renders status colour,
 * counts (done / failed / blocked), duration, and any PR links.
 * No-op when the banner slot isn't mounted or when no plan has
 * finished yet for this project.
 */
async function renderPlanRollup(projectId) {
  const slot = document.getElementById('plan-rollup-banner');
  if (!slot) return;
  let data;
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/plans-outcome`);
    if (!r.ok) return;
    data = await r.json();
  } catch { return; }
  const finished = (data.plans || []).filter(p => p.outcome);
  if (finished.length === 0) { slot.innerHTML = ''; return; }
  // Aggregate the most recent plan first — non-tech user usually
  // cares about "what happened just now", not historical sums.
  finished.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const recent = finished[0];
  const o = recent.outcome;
  const c = o.counts || {};
  const summaryColor = o.status === 'done' ? 'var(--color-green)'
    : o.status === 'failed' ? 'var(--color-red,#ef4444)'
    : 'var(--color-yellow,#eab308)';
  const headline = o.status === 'done' ? 'Plan finalizado correctamente'
    : o.status === 'failed' ? 'Plan terminado con errores'
    : 'Plan terminado parcialmente';
  const durationText = o.duration_ms != null ? formatDuration(o.duration_ms) : '—';
  slot.innerHTML = `
    <div style="margin:8px 0;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-left:4px solid ${summaryColor};border-radius:var(--radius-sm);font-size:0.85rem;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <span style="color:${summaryColor};font-weight:700;">${esc(headline)}</span>
      <span style="color:var(--text-muted);">${esc(recent.name || recent.planId)}</span>
      <span style="color:var(--text);">✓ ${c.done || 0} hechas</span>
      ${c.failed ? `<span style="color:var(--color-red,#ef4444)">✗ ${c.failed} fallidas</span>` : ''}
      ${c.blocked ? `<span style="color:var(--color-yellow,#eab308)">⏸ ${c.blocked} bloqueadas</span>` : ''}
      <span style="color:var(--text-muted);">⏱ ${esc(durationText)}</span>
      ${(o.prs || []).length > 0 ? `<span style="color:var(--text-muted);">${o.prs.length} PR(s):</span> ${o.prs.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener" style="color:var(--color-green);">abrir</a>`).join(' · ')}` : ''}
    </div>
  `;
}
