// KJC-TSK-0501 step 7/8 — Project picker view (default Board landing).
//
// Classic script (no exports). Loaded by index.html before app.js so
// the function declaration hoists into the script-level lexical
// environment and app.js can call renderProjectPicker() from its
// router.
//
// Globals consumed from earlier scripts / app.js:
//   - api()                       (utils/api.js)
//   - esc()                       (app.js)
//   - renderEmptyState()          (app.js)
//   - resolveProjectMeta()        (app.js)
//   - projectNameCache            (mutable, app.js)
//   - humaniseProjectName()       (app.js)

/**
 * "Pick a project" view shown by the Board tab when nothing is
 * selected. Lists every project that has at least one HU with the
 * pending / running / done / failed counts — clicking takes the
 * user into that project's kanban (`#board/<slug>`).
 *
 * Why this instead of an "All projects" merged kanban: HU short ids
 * collide across projects (every project has a `*-001`), the column
 * counts become meaningless, and "missing test contract" warnings
 * apply to whatever-project so the user can't tell what to act on.
 * Forcing a project pick before the kanban is the cheapest way to
 * keep every other UI invariant honest.
 */
async function renderProjectPicker() {
  const app = document.getElementById('app');
  const projects = await api('/api/projects');
  // Pre-resolve human names so the rendered list matches what the
  // header / dropdown show elsewhere.
  await Promise.all(projects.map((p) => resolveProjectMeta(p.id)));

  if (projects.length === 0) {
    app.innerHTML = renderEmptyState(
      'No projects yet',
      'Run kj plan or click ⚡ in the header to generate one. The board will pick it up automatically.'
    );
    return;
  }

  // Per-project status counts come from /api/projects/:id/stories.
  // One round-trip per project; cheap on a local SQLite-backed API.
  const allStories = await Promise.all(
    projects.map((p) => api(`/api/projects/${encodeURIComponent(p.id)}/stories`).then((s) => ({ id: p.id, stories: s })))
  );
  const byProject = new Map(allStories.map((entry) => [entry.id, entry.stories]));

  function bucket(stories) {
    const c = { pending: 0, running: 0, done: 0, failed: 0 };
    for (const s of stories) {
      if (['pending', 'certified', 'needs_context', 'blocked'].includes(s.status)) c.pending += 1;
      else if (['coding', 'reviewing'].includes(s.status)) c.running += 1;
      else if (s.status === 'done') c.done += 1;
      else if (s.status === 'failed') c.failed += 1;
    }
    return c;
  }

  // Sort: most recent activity first. Falls back to alphabetic when
  // last_activity is missing (older projects synced pre-#480).
  const sorted = [...projects].sort((a, b) => {
    const la = a.last_activity || '';
    const lb = b.last_activity || '';
    if (la && lb && la !== lb) return lb.localeCompare(la);
    return (a.name || a.id).localeCompare(b.name || b.id);
  });

  app.innerHTML = `
    <div class="section-header">
      <span class="section-header__title">${maggleText('board.title', 'Story Board')}</span>
      <span class="section-header__count">${sorted.length} ${maggleText('picker.project', 'project')}${sorted.length === 1 ? '' : 's'}</span>
    </div>
    <p style="padding:8px 4px 16px;color:var(--text-muted);font-size:0.9rem">
      ${maggleText('picker.hint', 'Pick a project to see its kanban. To switch later, go back to the Dashboard.')}
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:14px">
      ${sorted.map((p) => {
        const counts = bucket(byProject.get(p.id) || []);
        const total = counts.pending + counts.running + counts.done + counts.failed;
        const name = projectNameCache[p.id] || p.name || humaniseProjectName(p.id);
        // div en lugar de <button> para poder anidar el botón de
        // delete (HTML no permite buttons anidados). role+tabindex
        // mantienen la accesibilidad equivalente.
        return `
          <div role="button" tabindex="0" class="project-picker__card" data-project-id="${esc(p.id)}"
                  style="position:relative;text-align:left;display:flex;flex-direction:column;gap:8px;padding:14px 16px;
                         background:var(--bg-secondary);border:1px solid var(--border);
                         border-radius:var(--radius-sm);cursor:pointer;color:var(--text);
                         transition:border-color 120ms">
            <button class="project-card__delete" title="Borrar proyecto (cascade)"
                    data-project-id="${esc(p.id)}" data-project-name="${esc(name)}">🗑️</button>
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding-right:32px">
              <strong style="font-size:0.95rem">${esc(name)}</strong>
              <span style="font-size:0.75rem;color:var(--text-muted)">${total} HU${total === 1 ? '' : 's'}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:0.78rem">
              ${counts.pending > 0 ? `<span title="Pending" style="padding:2px 8px;border-radius:var(--radius-sm);background:var(--bg-primary)">⏳ ${counts.pending}</span>` : ''}
              ${counts.running > 0 ? `<span title="Running" style="padding:2px 8px;border-radius:var(--radius-sm);background:rgba(234,179,8,0.18);color:#facc15">⚙ ${counts.running}</span>` : ''}
              ${counts.done > 0 ? `<span title="Done" style="padding:2px 8px;border-radius:var(--radius-sm);background:rgba(74,222,128,0.18);color:#4ade80">✓ ${counts.done}</span>` : ''}
              ${counts.failed > 0 ? `<span title="Failed" style="padding:2px 8px;border-radius:var(--radius-sm);background:rgba(248,113,113,0.18);color:#f87171">✗ ${counts.failed}</span>` : ''}
              ${total === 0 ? `<span style="color:var(--text-muted)">empty</span>` : ''}
            </div>
            <div style="font-family:var(--font-mono, monospace);font-size:0.7rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.id)}">
              ${esc(p.id)}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  app.querySelectorAll('.project-picker__card').forEach((btn) => {
    const enter = () => {
      const id = btn.dataset.projectId;
      // Use the existing route so back/forward work and the dropdown
      // syncs via handleRoute().
      window.location.hash = `board/${encodeURIComponent(id)}`;
    };
    btn.addEventListener('click', (e) => {
      // Click sobre el botón delete anidado — el handler global ya
      // hace stopPropagation + preventDefault, pero por defensa
      // ignoramos aquí cualquier click que venga de dentro de él.
      if (e.target.closest('.project-card__delete')) return;
      enter();
    });
    btn.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.project-card__delete')) {
        e.preventDefault();
        enter();
      }
    });
    // Tiny hover affordance — no CSS file edit needed.
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--color-green)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border)'; });
  });
}
