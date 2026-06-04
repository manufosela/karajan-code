// KJC-TSK-0501 step 6/8 — Dashboard view (global stats + project cards).
//
// Classic script (no exports). Loaded by index.html after utils/api.js
// and the other utility scripts, before app.js. Function declarations
// hoist to the script-level lexical environment so app.js (and the
// `data-view="dashboard"` nav handler) can call renderDashboard()
// transparently.
//
// Globals consumed from earlier scripts / app.js:
//   - api()                       (utils/api.js)
//   - esc()                       (app.js)
//   - timeAgo()                   (utils/formatters.js)
//   - renderEmptyState()          (app.js)
//   - isTestTitle() / isTestIcon()(app.js)
//   - selectProject()             (app.js)

/**
 * Renders the dashboard view with global stats and project cards.
 */
async function renderDashboard() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading dashboard...</p></div>';

  try {
    const [stats, projects] = await Promise.all([
      api('/api/dashboard'),
      api('/api/projects'),
    ]);

    const certPct = stats.total_stories > 0
      ? Math.round((stats.certified_stories / stats.total_stories) * 100)
      : 0;

    app.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card__value">${stats.total_stories}</div>
          <div class="stat-card__label">Total Stories</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--green">${stats.certified_stories} (${certPct}%)</div>
          <div class="stat-card__label">Certified</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--yellow">${stats.pending_stories}</div>
          <div class="stat-card__label">Pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--purple">${stats.avg_quality !== null ? stats.avg_quality + '/60' : '--'}</div>
          <div class="stat-card__label">Avg Quality</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value">${stats.total_sessions}</div>
          <div class="stat-card__label">Sessions</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--green">${stats.approved_sessions}</div>
          <div class="stat-card__label">Approved</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value stat-card__value--purple">${stats.total_projects}</div>
          <div class="stat-card__label">Projects</div>
        </div>
      </div>

      <div class="section-header">
        <span class="section-header__title">Projects</span>
        <span class="section-header__count">${projects.length} projects</span>
      </div>

      ${projects.length === 0 ? renderEmptyState() : `
        <div class="projects-grid">
          ${projects.map((p) => `
            <div class="project-card">
              <button class="project-card__delete" title="Delete project (cascade)" data-project-id="${esc(p.id)}" data-project-name="${esc(p.name || p.id)}">🗑️</button>
              <button class="project-card__is-test" title="${esc(isTestTitle(p))}" data-project-id="${esc(p.id)}" data-is-test="${p.is_test === null || p.is_test === undefined ? '' : p.is_test}">${isTestIcon(p)}</button>
              <div class="project-card__body" onclick="selectProject('${esc(p.id)}')">
                <div class="project-card__name">${p.is_shared === 1 ? '<span class="project-card__shared-badge" title="Team-shared via .karajan-shared/">🔗</span> ' : ''}${esc(p.name || p.id)}</div>
                <div class="project-card__stats">
                  <div class="project-card__stat">
                    <div class="project-card__stat-value">${p.story_count || 0}</div>
                    <div class="project-card__stat-label">Stories</div>
                  </div>
                  <div class="project-card__stat">
                    <div class="project-card__stat-value">${p.certified_count || 0}</div>
                    <div class="project-card__stat-label">Certified</div>
                  </div>
                  <div class="project-card__stat">
                    <div class="project-card__stat-value">${p.session_count || 0}</div>
                    <div class="project-card__stat-label">Sessions</div>
                  </div>
                </div>
                <div class="project-card__activity">Last activity: ${timeAgo(p.last_activity)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><div class="empty-state__title">Error loading dashboard</div><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}
