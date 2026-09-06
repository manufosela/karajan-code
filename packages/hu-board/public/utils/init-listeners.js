// KJC-TSK-0501 step 8h/8 — Initialization listeners + boot sequence.
//
// Classic script (no exports). Loaded by index.html AFTER all other
// utils/*.js (including utils/server-push.js) so every globally
// declared function and `let` is available when these handlers and
// the boot block run.
//
// Globals consumed from earlier scripts / app.js:
//   - navigate(), render(), handleRoute() (app.js)
//   - showCommandLauncher(),
//     nextIsTestValue()               (utils/command-launcher.js)
//   - showHelp(), showConfirm(),
//     showError(), closeModal()       (utils/modals.js)
//   - showConfigEditor()              (utils/config-editor.js)
//   - showStoryDetail()               (utils/story-detail-view.js)
//   - showSessionDetail()             (utils/sessions-view.js)
//   - selectProject()                 (app.js)
//   - triggerSync(),
//     startStandbyPolling()           (utils/api.js)
//   - subscribeToServerEvents(),
//     smartRefresh()                  (utils/server-push.js)
//   - selectedProject, currentView,
//     refreshInterval                 (mutable `let` in app.js —
//                                      assignment crosses scripts via
//                                      shared-realm hoisting)

// ---- Initialization ----

// Nav button clicks
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

// Sync button — re-scan disk for new batches
document.getElementById('sync-btn').addEventListener('click', async () => {
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    await fetch('/api/sync', { method: 'POST' });
    render();
  } catch { /* ignore */ }
  btn.textContent = '🔄';
  btn.disabled = false;
});

// Commands button — opens the launcher modal so the user can run
// `kj plan`, `kj architect`, `kj clean` (and more later) without
// dropping to a terminal. Output streams to the existing log panel.
document.getElementById('commands-btn').addEventListener('click', () => {
  showCommandLauncher();
});

// Help button — KJC-TSK-0372. Quick reference modal for the 5 views.
// Hover tooltips on each tab cover the 1-line case; this modal is
// for users who arrive cold and want "ok, what does each one do?".
document.getElementById('help-btn').addEventListener('click', () => {
  showHelp();
});

// PR5: Settings button — opens the kj.config.yml editor modal.
// User picks coder/reviewer providers, model strategy, iteration
// caps, etc. in plain Spanish. Save writes the yml atomically;
// next `kj run` picks up the new config (no restart needed).
document.getElementById('config-btn').addEventListener('click', () => {
  showConfigEditor();
});

// Restart button — respawn the board server in place. The page's
// EventSource auto-reconnects so the user sees a brief "connecting…"
// blip and the board comes back live.
document.getElementById('restart-btn').addEventListener('click', async () => {
  const ok = await showConfirm(
    'Restart the HU Board server now? The page will reconnect automatically.',
    { title: 'Restart board', okLabel: 'Restart' }
  );
  if (!ok) return;
  try {
    await fetch('/api/board/restart', { method: 'POST' });
  } catch { /* the server is going down; the catch is expected */ }
  // Give the new server a beat to bind, then reload the page.
  setTimeout(() => window.location.reload(), 1200);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.project-card__is-test');
  if (!btn) return;
  e.stopPropagation();
  e.preventDefault();
  const projectId = btn.dataset.projectId;
  const next = nextIsTestValue(btn.dataset.isTest);
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/is-test`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_test: next }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Re-render the project list so the badge reflects the new value.
    render();
  } catch (err) {
    await showError(err.message, { title: 'Failed to update is_test' });
  }
});

// Delete project (cascade) — delegated handler on the dashboard grid
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.project-card__delete');
  if (!btn) return;
  e.stopPropagation();
  e.preventDefault();
  const projectId = btn.dataset.projectId;
  const projectName = btn.dataset.projectName || projectId;
  const ok = await showConfirm(
    `Delete project "${projectName}" and all its stories + sessions?\n\n`
    + `Also removes ~/.karajan/hu-stories/${projectId}/ from disk.`,
    { title: 'Delete project', okLabel: 'Delete', destructive: true }
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render();
  } catch (err) {
    await showError(err.message, { title: 'Failed to delete project' });
  }
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

// KJC-TSK-0414 PR4: arranca el polling del banner de standby al cargar la página.
startStandbyPolling();

// Initial load — sync disk data first so new batches are visible
triggerSync().then(() => {
  handleRoute();
  subscribeToServerEvents();
});

// Auto-refresh every 60 seconds as a SAFETY NET only — the board is
// SSE-driven (push from server) so this should rarely fire. We keep
// it at low frequency to recover from missed events on hibernation /
// network blip without flickering the UI every 10s like before.
// Uses smartRefresh too so it patches the DOM instead of full rerender.
refreshInterval = setInterval(async () => {
  if (document.getElementById('modal-backdrop').classList.contains('hidden')) {
    await triggerSync();
    await smartRefresh(null);
  }
}, 60_000);
