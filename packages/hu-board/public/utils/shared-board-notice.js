// KJC-TSK-1197 — notice shown above the kanban when the project's board mirrors the
// shared board (GitHub Issues, ADR 0025): what it is, how it changes, where it lives.
//
// Classic script (no exports), loaded before app.js like plan-rollup-view.js.
// Globals consumed: esc() (app.js).

// owner/name as GitHub allows them: nothing that could leave the href.
const SHARED_BOARD_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** The notice for the first plan that mirrors the shared board, or '' when there is none. */
function sharedBoardNoticeHtml(plans) {
  const mirror = (plans || []).find((p) => p.readonly === 'github');
  if (!mirror) return '';
  const link = SHARED_BOARD_REPO.test(mirror.repo || '')
    ? ` <a href="https://github.com/${mirror.repo}/issues?q=${encodeURIComponent('label:kj:hu')}" target="_blank" rel="noopener" style="color:var(--color-blue,#3b82f6);">Open its issues on GitHub (${esc(mirror.repo)})</a>`
    : '';
  return `
    <div role="note" style="margin:8px 0;padding:10px 14px;background:var(--bg-primary);border:1px solid var(--border);border-left:4px solid var(--color-blue,#3b82f6);border-radius:var(--radius-sm);font-size:0.85rem;">
      <strong>This is the team's shared board.</strong>
      Its stories live as GitHub Issues and the whole team sees the same ones, so it is read-only here:
      change a story with <code>kj hu move</code> from a terminal.${link}
    </div>
  `;
}

/** Fills the notice slot for a project. No-op when the slot is not mounted. */
async function renderSharedBoardNotice(projectId) {
  const slot = document.getElementById('shared-board-notice');
  if (!slot) return;
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/plans-outcome`);
  if (!r.ok) throw new Error(`plans-outcome answered ${r.status}`);
  slot.innerHTML = sharedBoardNoticeHtml((await r.json()).plans);
}
