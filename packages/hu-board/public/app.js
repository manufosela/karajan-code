/**
 * Karajan HU Board - Frontend Application
 * Vanilla JS single-page app with hash-based routing.
 */

/** @type {string} Current view */
let currentView = 'dashboard';

/** @type {string} Selected project ID (empty = all) */
let selectedProject = '';

/** @type {number | null} Auto-refresh interval ID */
let refreshInterval = null;

// ---- API Layer ----

/**
 * Fetches JSON from the API.
 * @param {string} path - API path (e.g., '/api/dashboard')
 * @returns {Promise<any>}
 */
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ---- Utility Functions ----

/**
 * Returns relative time string (e.g., "2 min ago").
 * @param {string} dateStr - ISO date string
 * @returns {string}
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Formats milliseconds to human readable duration.
 * @param {number | null} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (!ms) return '--';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec.toString().padStart(2, '0')}s`;
}

/**
 * Returns a quality score CSS class based on value.
 * @param {number | null} score
 * @param {number} max
 * @returns {string}
 */
function scoreClass(score, max = 60) {
  if (score === null || score === undefined) return '';
  const pct = score / max;
  if (pct >= 0.7) return 'story-card__score--good';
  if (pct >= 0.4) return 'story-card__score--ok';
  return 'story-card__score--bad';
}

/**
 * Generates quality bar HTML segments.
 * @param {number | null} score
 * @param {number} max
 * @returns {string}
 */
function qualityBar(score, max = 60) {
  if (score === null || score === undefined) return '';
  const filled = Math.round((score / max) * 10);
  let html = '<span class="quality-bar">';
  for (let i = 0; i < 10; i++) {
    html += `<span class="quality-bar__segment${i < filled ? ' quality-bar__segment--filled' : ''}"></span>`;
  }
  html += '</span>';
  return html;
}

/**
 * Escapes HTML entities.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Truncates text to a max length.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max = 100) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

// ---- Render Functions ----

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
            <div class="project-card" onclick="selectProject('${esc(p.id)}')">
              <div class="project-card__name">${esc(p.name || p.id)}</div>
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
          `).join('')}
        </div>
      `}
    `;
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><div class="empty-state__title">Error loading dashboard</div><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

/**
 * Renders the kanban board view.
 */
async function renderBoard() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading board...</p></div>';

  try {
    let stories;
    if (selectedProject) {
      stories = await api(`/api/projects/${encodeURIComponent(selectedProject)}/stories`);
    } else {
      // Get all stories from all projects
      const projects = await api('/api/projects');
      const allStories = await Promise.all(
        projects.map((p) => api(`/api/projects/${encodeURIComponent(p.id)}/stories`))
      );
      stories = allStories.flat();
    }

    const columns = {
      pending: stories.filter((s) => s.status === 'pending'),
      needs_context: stories.filter((s) => s.status === 'needs_context'),
      certified: stories.filter((s) => s.status === 'certified'),
      done: stories.filter((s) => s.status === 'done'),
    };

    if (stories.length === 0) {
      app.innerHTML = renderEmptyState();
      return;
    }

    app.innerHTML = `
      <div class="section-header">
        <span class="section-header__title">Story Board${selectedProject ? ` - ${esc(selectedProject)}` : ''}</span>
        <span class="section-header__count">${stories.length} stories</span>
      </div>
      <div class="kanban">
        ${renderKanbanColumn('Pending', 'pending', columns.pending)}
        ${renderKanbanColumn('Needs Context', 'needs-context', columns.needs_context)}
        ${renderKanbanColumn('Certified', 'certified', columns.certified)}
        ${renderKanbanColumn('Done', 'done', columns.done)}
      </div>
    `;
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><div class="empty-state__title">Error loading board</div><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

/**
 * Renders a single kanban column.
 * @param {string} title
 * @param {string} cssClass
 * @param {Array<object>} stories
 * @returns {string}
 */
function renderKanbanColumn(title, cssClass, stories) {
  return `
    <div class="kanban__column kanban__column--${cssClass}">
      <div class="kanban__column-header">
        <span class="kanban__column-title">${title}</span>
        <span class="kanban__column-count">${stories.length}</span>
      </div>
      ${stories.map(renderStoryCard).join('')}
      ${stories.length === 0 ? '<div style="text-align:center;color:var(--text-muted);font-size:0.8rem;padding:20px">No stories</div>' : ''}
    </div>
  `;
}

/**
 * Renders a story card for the kanban board.
 * @param {object} story
 * @returns {string}
 */
function renderStoryCard(story) {
  const title = story.title || story.original_text || story.id;
  const antipatterns = story.antipatterns ? JSON.parse(story.antipatterns) : [];
  const acCount = story.acceptance_criteria ? JSON.parse(story.acceptance_criteria).length : 0;

  return `
    <div class="story-card" onclick="showStoryDetail('${esc(story.id)}')">
      <div class="story-card__id">${esc(story.id)}</div>
      <div class="story-card__title">${esc(truncate(title, 100))}</div>
      <div class="story-card__meta">
        ${story.quality_total !== null ? `
          <span class="story-card__score ${scoreClass(story.quality_total)}">
            Score: ${story.quality_total}/60 ${qualityBar(story.quality_total)}
          </span>
        ` : ''}
        ${acCount > 0 ? `<span class="story-card__ac">AC: ${acCount} criteria${story.ac_format ? ` (${esc(story.ac_format)})` : ''}</span>` : ''}
      </div>
      ${antipatterns.length > 0 ? `<div class="story-card__antipattern">${antipatterns.map((a) => esc(a)).join(', ')}</div>` : ''}
      <div class="story-card__meta" style="margin-top:6px">
        <span class="story-card__status status--${story.status}">${esc(story.status)}</span>
        <span class="story-card__time">${timeAgo(story.updated_at)}</span>
      </div>
    </div>
  `;
}

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

  return `
    <div class="session-card" onclick="showSessionDetail('${esc(session.id)}')">
      <div class="session-card__header">
        <span class="session-card__id">${esc(session.id)}</span>
        <span class="session-card__status session-status--${session.status || 'unknown'}">${esc(session.status || 'unknown')}</span>
      </div>
      <div class="session-card__task">${esc(truncate(session.task, 150))}</div>
      <div class="session-card__meta">
        <span>Iterations: ${session.iterations || 0}</span>
        <span>Duration: ${formatDuration(session.duration_ms)}</span>
        <span>Stages: ${stages.join(', ') || '--'}</span>
        <span>${timeAgo(session.created_at)}</span>
      </div>
    </div>
  `;
}

/**
 * Renders an empty state component.
 * @param {string} title
 * @param {string} text
 * @returns {string}
 */
function renderEmptyState(title, text) {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">&#9744;</div>
      <div class="empty-state__title">${title || 'No data yet'}</div>
      <div class="empty-state__text">${text || 'HU stories and sessions will appear here as Karajan processes them.'}</div>
      <div class="empty-state__path">~/.karajan/hu-stories/</div>
    </div>
  `;
}

// ---- Detail Modals ----

/**
 * Shows the story detail modal.
 * @param {string} storyId
 */
async function showStoryDetail(storyId) {
  const backdrop = document.getElementById('modal-backdrop');
  const content = document.getElementById('modal-content');
  backdrop.classList.remove('hidden');

  content.innerHTML = '<div class="loading"><div class="loading__spinner"></div></div>';

  try {
    const story = await api(`/api/stories/${encodeURIComponent(storyId)}`);
    const antipatterns = story.antipatterns ? JSON.parse(story.antipatterns) : [];
    const ac = story.acceptance_criteria ? JSON.parse(story.acceptance_criteria) : [];
    const ctxRequests = story.context_requests || [];

    const dimLabels = ['Independent', 'Negotiable', 'Valuable', 'Estimable', 'Small', 'Testable'];

    content.innerHTML = `
      <div class="modal__header">
        <div>
          <div class="modal__title">${esc(story.id)}</div>
          <span class="story-card__status status--${story.status}">${esc(story.status)}</span>
        </div>
        <button class="modal__close" onclick="closeModal()">&times;</button>
      </div>

      <div class="modal__section">
        <div class="modal__section-title">Original Text</div>
        <div class="modal__field-value">${esc(story.original_text || 'N/A')}</div>
      </div>

      ${story.certified_as || story.certified_want || story.certified_so_that ? `
        <div class="modal__section">
          <div class="modal__section-title">Certified Story</div>
          <div class="modal__field">
            <div class="modal__field-label">As a...</div>
            <div class="modal__field-value">${esc(story.certified_as || '--')}</div>
          </div>
          <div class="modal__field">
            <div class="modal__field-label">I want to...</div>
            <div class="modal__field-value">${esc(story.certified_want || '--')}</div>
          </div>
          <div class="modal__field">
            <div class="modal__field-label">So that...</div>
            <div class="modal__field-value">${esc(story.certified_so_that || '--')}</div>
          </div>
        </div>
      ` : ''}

      ${story.quality_total !== null ? `
        <div class="modal__section">
          <div class="modal__section-title">Quality Score: ${story.quality_total}/60</div>
          <div class="modal__quality-grid">
            ${[1, 2, 3, 4, 5, 6].map((d, i) => {
              const val = story[`quality_d${d}`];
              return `
                <div class="modal__quality-dim">
                  <div class="modal__quality-dim-label">${dimLabels[i]}</div>
                  <div class="modal__quality-dim-value">${val !== null ? val + '/10' : '--'}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${antipatterns.length > 0 ? `
        <div class="modal__section">
          <div class="modal__section-title">Antipatterns</div>
          ${antipatterns.map((a) => `<div class="story-card__antipattern" style="margin-bottom:4px">${esc(a)}</div>`).join('')}
        </div>
      ` : ''}

      ${ac.length > 0 ? `
        <div class="modal__section">
          <div class="modal__section-title">Acceptance Criteria${story.ac_format ? ` (${esc(story.ac_format)})` : ''}</div>
          <ul class="modal__ac-list">
            ${ac.map((c) => {
              if (typeof c === 'string') return `<li class="modal__ac-item">${esc(c)}</li>`;
              if (c.given) return `<li class="modal__ac-item"><code>Given</code> ${esc(c.given)}<br><code>When</code> ${esc(c.when)}<br><code>Then</code> ${esc(c.then)}</li>`;
              return `<li class="modal__ac-item">${esc(JSON.stringify(c))}</li>`;
            }).join('')}
          </ul>
        </div>
      ` : ''}

      ${ctxRequests.length > 0 ? `
        <div class="modal__section">
          <div class="modal__section-title">Context Requests (${ctxRequests.length})</div>
          ${ctxRequests.map((cr) => `
            <div style="background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px;margin-bottom:6px;">
              <div style="font-size:0.8rem;color:var(--color-yellow);">${esc(cr.question || 'Fields needed: ' + (cr.fields_needed || ''))}</div>
              ${cr.answer ? `<div style="font-size:0.8rem;color:var(--color-green);margin-top:4px;">${esc(cr.answer)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="modal__section">
        <div class="modal__section-title">Metadata</div>
        <div class="modal__field"><span class="modal__field-label">Project:</span> ${esc(story.project_id)}</div>
        <div class="modal__field"><span class="modal__field-label">Session:</span> ${esc(story.session_id || '--')}</div>
        <div class="modal__field"><span class="modal__field-label">Created:</span> ${esc(story.created_at || '--')}</div>
        <div class="modal__field"><span class="modal__field-label">Updated:</span> ${esc(story.updated_at || '--')}</div>
        ${story.certified_at ? `<div class="modal__field"><span class="modal__field-label">Certified at:</span> ${esc(story.certified_at)}</div>` : ''}
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="modal__header"><div class="modal__title">Error</div><button class="modal__close" onclick="closeModal()">&times;</button></div><p>${esc(err.message)}</p>`;
  }
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

    content.innerHTML = `
      <div class="modal__header">
        <div>
          <div class="modal__title">${esc(session.id)}</div>
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

      <div class="modal__section">
        <div class="modal__section-title">Metadata</div>
        <div class="modal__field"><span class="modal__field-label">Project:</span> ${esc(session.project_id)}</div>
        <div class="modal__field"><span class="modal__field-label">Created:</span> ${esc(session.created_at || '--')}</div>
        <div class="modal__field"><span class="modal__field-label">Updated:</span> ${esc(session.updated_at || '--')}</div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="modal__header"><div class="modal__title">Error</div><button class="modal__close" onclick="closeModal()">&times;</button></div><p>${esc(err.message)}</p>`;
  }
}

/**
 * Closes the modal.
 */
function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}

// ---- Navigation ----

/**
 * Navigates to a specific view.
 * @param {string} view - 'dashboard', 'board', or 'sessions'
 */
function navigate(view) {
  currentView = view;
  window.location.hash = selectedProject ? `${view}/${selectedProject}` : view;

  // Update active nav button
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  render();
}

/**
 * Selects a project and navigates to the board view.
 * @param {string} projectId
 */
function selectProject(projectId) {
  selectedProject = projectId;
  document.getElementById('project-select').value = projectId;
  navigate('board');
}

/**
 * Renders the current view.
 */
function render() {
  switch (currentView) {
    case 'dashboard': return renderDashboard();
    case 'board': return renderBoard();
    case 'sessions': return renderSessions();
    default: return renderDashboard();
  }
}

/**
 * Populates the project selector dropdown.
 */
async function populateProjectSelect() {
  try {
    const projects = await api('/api/projects');
    const select = document.getElementById('project-select');
    // Keep the "All Projects" option
    select.innerHTML = '<option value="">All Projects</option>';
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      select.appendChild(opt);
    }
  } catch {
    // Silently fail — project list will be empty
  }
}

/**
 * Parses the hash route and renders.
 */
function handleRoute() {
  const hash = window.location.hash.slice(1) || 'dashboard';
  const parts = hash.split('/');
  currentView = parts[0] || 'dashboard';
  selectedProject = parts[1] || '';

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === currentView);
  });

  document.getElementById('project-select').value = selectedProject;
  render();
}

// ---- Initialization ----

// Nav button clicks
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

// Project selector
document.getElementById('project-select').addEventListener('change', (e) => {
  selectedProject = e.target.value;
  window.location.hash = selectedProject ? `${currentView}/${selectedProject}` : currentView;
  render();
});

// Modal close on backdrop click
document.getElementById('modal-backdrop').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ESC to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Hash routing
window.addEventListener('hashchange', handleRoute);

// Make functions available globally for onclick handlers
window.showStoryDetail = showStoryDetail;
window.showSessionDetail = showSessionDetail;
window.closeModal = closeModal;
window.selectProject = selectProject;

// Initial load
populateProjectSelect();
handleRoute();

// Auto-refresh every 10 seconds
refreshInterval = setInterval(() => {
  if (document.getElementById('modal-backdrop').classList.contains('hidden')) {
    render();
  }
}, 10000);
