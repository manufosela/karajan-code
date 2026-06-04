// KJC-TSK-0501 step 8g/8 — Server-push updates (SSE → smart DOM patch).
//
// Classic script (no exports). Loaded by index.html before app.js so
// the top-level `function` / `let` declarations are hoisted into the
// shared realm and `subscribeToServerEvents` is callable from app.js's
// DOMContentLoaded handler.
//
// Globals consumed from earlier scripts / app.js:
//   - showPromptModal()              (utils/modals.js)
//   - closePromptModalIfMatches()    (utils/modals.js)
//   - render()                       (app.js)
//   - api()                          (utils/api.js)
//   - renderStoryCard()              (utils/board-view.js)
//   - cssEscape()                    (utils/formatters.js)
//   - currentView                    (mutable in app.js — read here)
//   - selectedProject                (mutable in app.js — read here)

// ---- Server-push updates ----
//
// The board gets a one-way stream of events from the server via
// Server-Sent Events; each event hints at what changed (plan file,
// session, batch). On receipt we refresh the current view in a way
// that preserves scroll position and any open modal. Full-page
// re-render is no longer on the table — clicking around doesn't
// reset your scroll anymore.
//
// EventSource auto-reconnects on drop, so we don't manage lifecycle
// ourselves. The status line below the header flashes briefly on
// each update so the user can see the data is live.

let sseSource = null;
let sseRefreshTimer = null;

function subscribeToServerEvents() {
  if (typeof EventSource === 'undefined') return;   // ancient browser
  if (sseSource) sseSource.close();
  sseSource = new EventSource('/api/events');
  sseSource.addEventListener('message', (e) => {
    // Try to parse the event as a typed payload. Prompt events drive
    // the prompt modal; everything else just nudges a re-render.
    let payload;
    try { payload = JSON.parse(e.data); } catch { payload = null; }

    if (payload?.type === 'prompt' && payload.promptId) {
      // A non-interactive runner is asking for input — pop the modal
      // immediately. fetch the full prompt body from the API so we
      // don't depend on the SSE event carrying every field.
      fetch(`/api/prompts`).then(r => r.ok ? r.json() : []).then((list) => {
        const match = list.find((p) => p.promptId === payload.promptId);
        if (match) showPromptModal(match);
      }).catch(() => {});
      return;
    }
    if (payload?.type === 'prompt-resolved' && payload.promptId) {
      // Runner read its answer file — close the modal if it's still open.
      closePromptModalIfMatches(payload.promptId);
      return;
    }

    // Default: data changed somewhere. Try the targeted DOM patch
    // first (no parpadeo, preserves scroll + hover state) and only
    // fall back to a full re-render when the patch can't apply
    // (different view, missing markers, etc.). This is the fix for
    // the "todo el board parpadea cada vez que algo cambia" UX bug.
    if (sseRefreshTimer) clearTimeout(sseRefreshTimer);
    sseRefreshTimer = setTimeout(() => smartRefresh(payload), 150);
  });
  sseSource.addEventListener('error', () => {
    // EventSource handles reconnection. Nothing to do; browsers retry
    // the `retry:` value we sent on open.
  });

  // On boot, also fetch any prompts that were already pending before
  // this tab connected (we missed their SSE add-event).
  fetch('/api/prompts').then((r) => r.ok ? r.json() : []).then((list) => {
    for (const p of list) showPromptModal(p);
  }).catch(() => {});
}

/**
 * Refresh the current SPA view without touching scroll position or
 * any modal state. The heavy lifting already lives in renderBoard /
 * renderGraph / renderSessions; this just re-calls them while the
 * scroll offset is pinned, so the visual effect is "the card
 * status updated in place".
 * @param {string} _rawEvent unused for now — we could branch on
 *   event type later to patch only the touched card, but a full
 *   re-render with scroll preservation is already invisible to
 *   the user and a lot simpler to reason about.
 */
async function refreshCurrentView(_rawEvent) {
  const app = document.getElementById('app');
  const scrollTop = app?.scrollTop ?? 0;
  const scrollLeft = app?.scrollLeft ?? 0;
  // Modal is in a separate DOM branch (#modal-backdrop) so render()
  // never touches it — we don't need to save its state.
  try {
    await render();
  } finally {
    const fresh = document.getElementById('app');
    if (fresh) {
      fresh.scrollTop = scrollTop;
      fresh.scrollLeft = scrollLeft;
    }
  }
}

/**
 * Smart refresh: pick the cheapest possible DOM update for the
 * incoming SSE event. Today the server sends coarse-grained events
 * (`{type: 'plan'|'batch'|'session'|'prompt'|...}`), so we route by
 * type:
 *
 *   plan / batch on the board view  → patchBoardIncremental()
 *   anything else                    → refreshCurrentView() (full re-render)
 *
 * The patch path preserves DOM nodes (no innerHTML rewrite, no
 * scroll reset, no hover/focus loss) — this is what kills the
 * "parpadeo" the user reported.
 *
 * @param {object|null} payload The parsed SSE payload, or null when
 *   the event wasn't valid JSON. Coarse types still work (we just
 *   degrade to a full re-render).
 */
async function smartRefresh(payload) {
  const onBoard = currentView === 'board' && Boolean(selectedProject);
  const isStoryRelated = payload && ['plan', 'batch'].includes(payload.type);
  if (onBoard && isStoryRelated) {
    const ok = await patchBoardIncremental();
    if (ok) return;
  }
  await refreshCurrentView();
}

/**
 * Targeted DOM patch for the Kanban board. Re-fetches the project's
 * stories, diffs them against the cards already rendered, and only
 * touches the affected nodes:
 *
 *   - status changed → move the card to the new column with a
 *     subtle animation (no DOM recreation, listeners survive)
 *   - new story      → render + insert into the right column
 *   - story removed  → fade + remove
 *   - column counts and the running badge are updated in place
 *
 * Returns false if the board's DOM markers aren't present (different
 * view, error state, etc.) so smartRefresh can fall back to a full
 * re-render.
 *
 * @returns {Promise<boolean>}
 */
async function patchBoardIncremental() {
  const kanban = document.querySelector('.kanban');
  if (!kanban) return false;          // not on the board view
  const columns = {};
  for (const col of kanban.querySelectorAll('.kanban__column')) {
    const cls = col.dataset.column;
    if (cls) columns[cls] = col;
  }
  if (!columns.pending || !columns.running) return false;

  let stories;
  try {
    stories = await api(`/api/projects/${encodeURIComponent(selectedProject)}/stories`);
  } catch { return false; }

  // Re-derive the column → status mapping (kept in lockstep with
  // renderBoard's `columns` object — change there, change here).
  const statusToColumn = (status) => {
    if (['pending', 'certified', 'needs_context', 'blocked'].includes(status)) return 'pending';
    if (['coding', 'reviewing'].includes(status)) return 'running';
    if (status === 'done') return 'done';
    if (status === 'failed') return 'failed';
    return 'pending';                  // safe default
  };

  const seen = new Set();
  for (const story of stories) {
    seen.add(story.id);
    const targetCol = columns[statusToColumn(story.status)];
    if (!targetCol) continue;
    const existing = kanban.querySelector(`.story-card[data-story-id="${cssEscape(story.id)}"]`);
    if (!existing) {
      // New story — append to its column.
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderStoryCard(story).trim();
      const node = wrapper.firstElementChild;
      if (node) {
        node.style.opacity = '0';
        targetCol.appendChild(node);
        requestAnimationFrame(() => { node.style.transition = 'opacity 200ms'; node.style.opacity = '1'; });
      }
      continue;
    }
    const previousStatus = existing.dataset.status;
    if (previousStatus !== story.status) {
      // Status changed — move the node + replace its inner content
      // (counters, time-ago, status pill) without recreating the
      // outer node so click handlers + transitions survive.
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderStoryCard(story).trim();
      const fresh = wrapper.firstElementChild;
      if (fresh) {
        existing.innerHTML = fresh.innerHTML;
        existing.dataset.status = story.status;
        existing.setAttribute('onclick', fresh.getAttribute('onclick') || '');
        if (existing.parentElement !== targetCol) {
          existing.style.transition = 'opacity 150ms';
          existing.style.opacity = '0.3';
          setTimeout(() => {
            targetCol.appendChild(existing);
            requestAnimationFrame(() => { existing.style.opacity = '1'; });
          }, 150);
        }
      }
    } else {
      // Same status — just refresh the inner block (counters / time
      // ago / antipatterns may have changed) without moving.
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderStoryCard(story).trim();
      const fresh = wrapper.firstElementChild;
      if (fresh && fresh.innerHTML !== existing.innerHTML) {
        existing.innerHTML = fresh.innerHTML;
      }
    }
  }
  // Cards that no longer exist on the server → remove with a fade.
  for (const node of kanban.querySelectorAll('.story-card')) {
    if (!seen.has(node.dataset.storyId)) {
      node.style.transition = 'opacity 150ms';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 160);
    }
  }
  // Recount each column + update the "N running" badge in the header.
  for (const [cls, col] of Object.entries(columns)) {
    const counter = col.querySelector('[data-column-count]');
    if (counter) counter.textContent = String(col.querySelectorAll('.story-card').length);
    col.style.opacity = col.querySelectorAll('.story-card').length === 0 ? '0.55' : '1';
  }
  const runningCount = columns.running.querySelectorAll('.story-card').length;
  const runningBadge = document.querySelector('.section-header__badge');
  if (runningBadge) {
    if (runningCount > 0) {
      runningBadge.textContent = `⚙ ${runningCount} running…`;
      runningBadge.style.display = '';
    } else {
      runningBadge.style.display = 'none';
    }
  }
  return true;
}
