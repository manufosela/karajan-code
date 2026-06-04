// KJC-TSK-0501 step 4/8 — Sessions view (list + card + detail modal).
//
// Classic script (no exports). Loaded by index.html after utils/formatters.js,
// utils/modals.js and utils/api.js, before app.js. Function declarations and
// top-level vars hoist to the window scope so app.js (and inline onclick
// handlers like `showSessionDetail(...)`) can call them transparently.
//
// Globals consumed from earlier scripts / app.js:
//   - api()                       (utils/api.js)
//   - formatSessionLabel()        (utils/formatters.js)
//   - formatDuration()            (utils/formatters.js)
//   - timeAgo()                   (utils/formatters.js)
//   - esc()                       (app.js)
//   - closeModal()                (utils/modals.js)
//   - renderEmptyState()          (app.js)
//   - selectedProject (mutable global)  (app.js)

/**
 * Renders the sessions view.
 */
async function renderSessions() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading sessions...</p></div>';

  try {
    let sessions;
    if (selectedProject) {
      sessions = await api(`/api/projects/${encodeURIComponent(selectedProject)}/sessions`);
    } else {
      sessions = await api('/api/sessions');
    }

    if (sessions.length === 0) {
      app.innerHTML = `
        <div class="section-header">
          <span class="section-header__title">Sessions</span>
          <span class="section-header__count">0 sessions</span>
        </div>
        ${renderEmptyState('No sessions found', 'KJ sessions will appear here when you run karajan.')}
      `;
      return;
    }

    app.innerHTML = `
      <div class="section-header">
        <span class="section-header__title">Sessions${selectedProject ? ` - ${esc(selectedProject)}` : ''}</span>
        <span class="section-header__count">${sessions.length} sessions</span>
      </div>
      <div class="sessions-list">
        ${sessions.map(renderSessionCard).join('')}
      </div>
    `;
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><div class="empty-state__title">Error loading sessions</div><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

/**
 * Renders a session card.
 * @param {object} session
 * @returns {string}
 */
function renderSessionCard(session) {
  const stages = session.stages_completed ? JSON.parse(session.stages_completed) : [];
  const label = formatSessionLabel(session);

  return `
    <div class="session-card" onclick="showSessionDetail('${esc(session.id)}')">
      <div class="session-card__header">
        <span class="session-card__title" title="${esc(session.id)}">${esc(label.title)}</span>
        <span class="session-card__status session-status--${session.status || 'unknown'}">${esc(session.status || 'unknown')}</span>
      </div>
      ${label.subtitle ? `<div class="session-card__task">${esc(label.subtitle)}</div>` : ''}
      <div class="session-card__meta">
        <span>Iterations: ${session.iterations || 0}</span>
        <span>Duration: ${formatDuration(session.duration_ms)}</span>
        <span>Stages: ${stages.join(', ') || '--'}</span>
        <span>${timeAgo(session.created_at)}</span>
      </div>
      <div class="session-card__id-chip" title="Session ID — use with kj resume &lt;id&gt;">${esc(label.idChip)}</div>
    </div>
  `;
}

/**
 * Shows the session detail modal.
 * @param {string} sessionId
 */
async function showSessionDetail(sessionId) {
  const backdrop = document.getElementById('modal-backdrop');
  const content = document.getElementById('modal-content');
  backdrop.classList.remove('hidden');

  content.innerHTML = '<div class="loading"><div class="loading__spinner"></div></div>';

  try {
    const session = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const checkpoints = session.checkpoints || [];
    const config = session.config_snapshot || {};
    const budget = session.budget || {};
    const startTime = session.created_at ? new Date(session.created_at).getTime() : 0;

    const __label = formatSessionLabel(session);
    content.innerHTML = `
      <div class="modal__header">
        <div>
          <div class="modal__title">${esc(__label.title)}</div>
          <div class="modal__subtitle session-card__id-chip" title="Use with kj resume &lt;id&gt;">${esc(session.id)}</div>
          <span class="session-card__status session-status--${session.status}">${esc(session.status)}</span>
        </div>
        <button class="modal__close" onclick="closeModal()">&times;</button>
      </div>

      <div class="modal__section">
        <div class="modal__section-title">Task</div>
        <div class="modal__field-value" style="font-size:0.85rem">${esc(session.task || 'N/A')}</div>
      </div>

      <div class="modal__section">
        <div class="modal__section-title">Overview</div>
        <div class="stats-grid" style="margin-bottom:0">
          <div class="stat-card">
            <div class="stat-card__value">${session.iterations || 0}</div>
            <div class="stat-card__label">Iterations</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__value">${formatDuration(session.duration_ms)}</div>
            <div class="stat-card__label">Duration</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__value ${session.approved ? 'stat-card__value--green' : 'stat-card__value--yellow'}">${session.approved ? 'Yes' : 'No'}</div>
            <div class="stat-card__label">Approved</div>
          </div>
        </div>
      </div>

      ${config.coder || config.reviewer ? `
        <div class="modal__section">
          <div class="modal__section-title">Configuration</div>
          <div style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-secondary)">
            ${config.coder ? `Coder: ${esc(config.coder)}` : ''}
            ${config.reviewer ? ` | Reviewer: ${esc(config.reviewer)}` : ''}
          </div>
        </div>
      ` : ''}

      ${checkpoints.length > 0 ? `
        <div class="modal__section">
          <div class="modal__section-title">Timeline (${checkpoints.length} checkpoints)</div>
          <div class="timeline">
            ${checkpoints.map((cp) => {
              const elapsed = cp.at && startTime ? formatDuration(new Date(cp.at).getTime() - startTime) : '';
              const isOk = cp.ok === true || cp.approved === true;
              const isFail = cp.ok === false || cp.approved === false;
              const itemClass = isOk ? 'timeline__item--ok' : isFail ? 'timeline__item--fail' : 'timeline__item--info';

              let detail = '';
              if (cp.note) detail = cp.note;
              else if (cp.approved !== undefined) detail = cp.approved ? 'APPROVED' : `REJECTED (${cp.blocking_issues || 0} issues)`;
              else if (cp.reason) detail = cp.reason;
              else if (cp.ok !== undefined) detail = cp.ok ? 'PASSED' : 'FAILED';
              if (cp.provider) detail += ` [${cp.provider}]`;

              return `
                <div class="timeline__item ${itemClass}">
                  <span class="timeline__time">${elapsed}</span>
                  <div class="timeline__stage">[${esc(cp.stage)}] iter ${cp.iteration || 0}</div>
                  <div class="timeline__detail">${esc(detail)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${budget.total_cost_usd !== undefined ? `
        <div class="modal__section">
          <div class="modal__section-title">Budget</div>
          <div style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-secondary)">
            Tokens: ${budget.total_tokens || 0} | Cost: $${(budget.total_cost_usd || 0).toFixed(4)}
          </div>
        </div>
      ` : ''}

      <details class="modal__section" style="margin-top:8px">
        <summary style="cursor:pointer;font-weight:600;font-size:0.85rem;color:var(--text-muted);padding:6px 0">
          Metadata
        </summary>
        <div style="padding-top:6px">
          <div class="modal__field"><span class="modal__field-label">Project:</span> ${esc(session.project_id)}</div>
          <div class="modal__field"><span class="modal__field-label">Created:</span> ${esc(session.created_at || '--')}</div>
          <div class="modal__field"><span class="modal__field-label">Updated:</span> ${esc(session.updated_at || '--')}</div>
        </div>
      </details>
    `;
  } catch (err) {
    content.innerHTML = `<div class="modal__header"><div class="modal__title">Error</div><button class="modal__close" onclick="closeModal()">&times;</button></div><p>${esc(err.message)}</p>`;
  }
}
