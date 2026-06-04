// KJC-TSK-0501 step 7/8 — HU detail modal (read-only view).
//
// Classic script (no exports). Loaded by index.html before app.js so
// the function declaration hoists and inline onclick="showStoryDetail(...)"
// handlers emitted by board-view / graph-view resolve transparently.
//
// Globals consumed from earlier scripts / app.js:
//   - api()                       (utils/api.js)
//   - esc()                       (app.js)
//   - resolveProjectInitials()    (app.js)
//   - shortStoryId()              (app.js)
//   - projectIsSharedCache        (mutable, app.js)
//   - renderStoryEditForm()       (app.js)
//   - closeModal(), changeHuStatusFromModal(), resetHuToPending(),
//     undoHuChanges(), saveHuModels(), saveHuAssignee() — bound on
//     window from app.js so the inline handlers in this template
//     keep working unchanged.

/**
 * Show the HU detail modal in read-only mode. Fetches the full row
 * (one round-trip — the kanban only carries a projection) and renders
 * every field the planner / coder / reviewer may have populated:
 * Original Text, Models (per-HU coder/reviewer overrides), Assignee
 * (only for team-shared projects), Certified Story, Quality Score,
 * Antipatterns, Acceptance Criteria, Acceptance Tests, Context
 * Requests, Metadata. Header chrome surfaces Edit / Reset / Undo
 * buttons gated on the HU's current status + outcome snapshot.
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
    const tests = story.acceptance_tests ? JSON.parse(story.acceptance_tests) : [];
    const ctxRequests = story.context_requests || [];
    const initials = await resolveProjectInitials(story.project_id);
    const shortId = shortStoryId(story, initials);

    const dimLabels = ['Independent', 'Negotiable', 'Valuable', 'Estimable', 'Small', 'Testable'];

    // Edit-in-place is gated on plan-backed stories: legacy rows
    // (plan_id null) have no source-of-truth file to write to, so PATCH
    // would 409 anyway.
    const canEdit = ['pending', 'certified', 'needs_context', 'blocked'].includes(story.status);
    // KJC-TSK-0394 step 2: "Reset to pending" para destrabar HUs zombi
    // (coding/reviewing/blocked colgados) o relanzar limpio una HU
    // done/failed. Solo plan-backed. Pending/certified ya están en el
    // estado destino, no tiene sentido el botón.
    const canResetToPending = story.plan_id
      && !['pending', 'certified'].includes(story.status);
    // Dropdown libre de status. Solo plan-backed. La lista es la misma
    // que ALLOWED_STORY_STATUSES en el backend — NO incluye coding/
    // reviewing/running (esos los pone el orquestador; setearlos a
    // mano genera zombies en el reaper).
    const canChangeStatus = !!story.plan_id;
    // KJC-TSK-0403: 'failed' eliminado del dropdown — result=fail vive en
    // la HU via outcome.blockers, no como status manual.
    const userSettableStatuses = ['pending', 'certified', 'done', 'blocked', 'needs_context'];

    content.innerHTML = `
      <div class="modal__header">
        <div>
          <div class="modal__title" title="${esc(story.id)}">${esc(shortId)}</div>
          <div class="modal__subtitle" style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;margin-top:2px">${esc(story.id)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <span class="story-card__status status--${story.status}">${esc(story.status)}</span>
            ${canChangeStatus ? `
              <select id="hu-status-select"
                      title="Cambiar manualmente el status de esta HU"
                      style="padding:3px 6px;font-size:0.75rem;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer"
                      onchange="changeHuStatusFromModal('${esc(story.id)}', this.value, '${esc(story.status)}')">
                <option value="">Cambiar a…</option>
                ${userSettableStatuses
                  .filter((s) => s !== story.status)
                  .map((s) => `<option value="${s}">${s}</option>`)
                  .join('')}
              </select>
            ` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canEdit ? `
            <button id="edit-hu-btn" class="control-btn"
                    style="padding:6px 12px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem"
                    title="Edit title, scope, task type, and acceptance criteria">
              ✎ Edit
            </button>
          ` : ''}
          ${canResetToPending ? `
            <button id="reset-hu-btn" class="control-btn"
                    style="padding:6px 12px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem"
                    title="Devolver esta HU a pending (sin tocar el result anterior)"
                    onclick="resetHuToPending('${esc(story.id)}')">
              ↺ Reset
            </button>
          ` : ''}
          ${(() => {
            // KJC-TSK-0408: Undo solo si la HU tiene snapshot_sha en outcome.
            let parsedOutcome = null;
            try { parsedOutcome = typeof story.outcome === 'string' ? JSON.parse(story.outcome) : story.outcome; } catch { /* */ }
            const canUndo = parsedOutcome?.snapshot_sha && !parsedOutcome?.reverted;
            return canUndo ? `
              <button id="undo-hu-btn" class="control-btn"
                      style="padding:6px 12px;border:1px solid var(--color-red,#ef4444);background:var(--bg-primary);color:var(--color-red,#ef4444);border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem"
                      title="Deshacer cambios de esta HU: restaura los ficheros al snapshot pre-run y marca pending"
                      onclick="undoHuChanges('${esc(story.id)}')">
                ⏪ Undo
              </button>
            ` : '';
          })()}
          <button class="modal__close" onclick="closeModal()">&times;</button>
        </div>
      </div>


      <div class="modal__section">
        <div class="modal__section-title">Original Text</div>
        <div class="modal__field-value">${esc(story.original_text || 'N/A')}</div>
      </div>

      ${(story.coder_model || story.reviewer_model || canEdit) ? `
        <!-- KJC-TSK-0406: model routing per HU. Cada modelo es independiente
             y editable. Reviewer cross-provider del coder por defecto. -->
        <div class="modal__section">
          <div class="modal__section-title">Models</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:0.85rem">
            <div>
              <div class="modal__field-label">Coder</div>
              <div class="modal__field-value" style="font-family:monospace">
                ${esc(story.coder_model || 'auto')} ${story.coder_provider ? `<span style="color:var(--text-muted)">(${esc(story.coder_provider)})</span>` : ''}
              </div>
              ${canEdit ? `
                <input id="hu-coder-model" type="text" placeholder="modelo override"
                       value="${esc(story.coder_model || '')}"
                       style="margin-top:4px;width:100%;padding:4px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;font-family:monospace;font-size:0.8rem">
              ` : ''}
            </div>
            <div>
              <div class="modal__field-label">Reviewer (cross-provider)</div>
              <div class="modal__field-value" style="font-family:monospace">
                ${esc(story.reviewer_model || 'auto')} ${story.reviewer_provider ? `<span style="color:var(--text-muted)">(${esc(story.reviewer_provider)})</span>` : ''}
              </div>
              ${canEdit ? `
                <input id="hu-reviewer-model" type="text" placeholder="modelo override"
                       value="${esc(story.reviewer_model || '')}"
                       style="margin-top:4px;width:100%;padding:4px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;font-family:monospace;font-size:0.8rem">
              ` : ''}
            </div>
          </div>
          ${canEdit ? `
            <div style="margin-top:8px;display:flex;gap:6px;align-items:center">
              <button onclick="saveHuModels('${esc(story.id)}')" class="control-btn"
                      style="padding:4px 10px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:0.8rem">
                💾 Save models
              </button>
              <span style="color:var(--text-muted);font-size:0.75rem">vacío → re-asignar automáticamente</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${projectIsSharedCache[story.project_id] === 1 ? `
        <!-- KJC-PRP-0002 PR6: per-HU assignee — only surfaced when the
             project is team-shared. Free-form string; no entity table. -->
        <div class="modal__section">
          <div class="modal__section-title">Asignado a</div>
          <div class="modal__field-value" style="font-family:monospace">${esc(story.assignee || '—')}</div>
          ${canEdit ? `
            <div style="margin-top:6px;display:flex;gap:6px;align-items:center">
              <input id="hu-assignee" type="text" placeholder="@manu, dev_016, becaria…"
                     value="${esc(story.assignee || '')}"
                     style="flex:1;padding:4px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;font-family:monospace;font-size:0.8rem">
              <button onclick="saveHuAssignee('${esc(story.id)}')" class="control-btn"
                      style="padding:4px 10px;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:0.8rem">
                💾 Save
              </button>
            </div>
            <div style="margin-top:4px;color:var(--text-muted);font-size:0.75rem">vacío → sin asignar</div>
          ` : ''}
        </div>
      ` : ''}

      ${story.certified_as ? `
        <div class="modal__section">
          <div class="modal__section-title">Certified Story</div>
          <div class="modal__field">
            <div class="modal__field-label">As a...</div>
            <div class="modal__field-value">${esc(story.certified_as)}</div>
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
      ` : story.certified_want ? `
        <div class="modal__section">
          <div class="modal__section-title">Scope</div>
          <div class="modal__field-value" style="white-space: pre-wrap; font-size: 0.9rem; line-height: 1.5;">${esc(story.certified_want)}</div>
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

      ${tests.length === 0 ? `
        <div class="modal__section" style="border:1px solid var(--color-yellow,#eab308);background:rgba(234,179,8,0.08);padding:10px 12px;border-radius:var(--radius-sm)">
          <div class="modal__section-title" style="color:var(--color-yellow,#eab308)">⚠ Missing test contract</div>
          <div style="font-size:0.85rem;line-height:1.5;margin-top:4px">
            This HU has no acceptance_tests declared. The tests-first pipeline (v2.7.5)
            refuses to run HUs without an executable contract. Click ✎ Edit above and
            add at least one test — a <code>shell</code> command that exits 0 on pass,
            or a <code>gherkin</code> Given/When/Then spec.
          </div>
        </div>
      ` : `
        <div class="modal__section">
          <div class="modal__section-title">Acceptance Tests (${tests.length})</div>
          <ul class="modal__ac-list">
            ${tests.map((t) => {
              // Legacy form: plain string — render as shell.
              if (typeof t === 'string') {
                return `<li class="modal__ac-item"><span style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-right:8px">shell</span><code>${esc(t)}</code></li>`;
              }
              // v2.7.5 structured form: { type, content, file? }
              if (t && typeof t === 'object' && typeof t.content === 'string') {
                const type = t.type === 'gherkin' ? 'gherkin' : 'shell';
                const badgeColor = type === 'gherkin' ? 'var(--color-blue,#3b82f6)' : 'var(--text-muted)';
                const fileBit = t.file ? ` <span style="color:var(--text-muted);font-size:0.75rem;margin-left:8px">→ ${esc(t.file)}</span>` : '';
                if (type === 'gherkin') {
                  return `<li class="modal__ac-item"><span style="font-size:0.7rem;color:${badgeColor};text-transform:uppercase;letter-spacing:0.5px;margin-right:8px">gherkin</span>${fileBit}<pre style="white-space:pre-wrap;margin:4px 0 0 0;font-family:inherit;font-size:0.9rem;line-height:1.5">${esc(t.content)}</pre></li>`;
                }
                return `<li class="modal__ac-item"><span style="font-size:0.7rem;color:${badgeColor};text-transform:uppercase;letter-spacing:0.5px;margin-right:8px">shell</span>${fileBit}<code>${esc(t.content)}</code></li>`;
              }
              // Fallback for anything else: show the raw JSON so the user
              // can diagnose malformed entries.
              return `<li class="modal__ac-item"><code>${esc(JSON.stringify(t))}</code></li>`;
            }).join('')}
          </ul>
        </div>
      `}

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

      <details class="modal__section" style="margin-top:8px">
        <summary style="cursor:pointer;font-weight:600;font-size:0.85rem;color:var(--text-muted);padding:6px 0">
          Metadata
        </summary>
        <div style="padding-top:6px">
          <div class="modal__field"><span class="modal__field-label">Project:</span> ${esc(story.project_id)}</div>
          ${story.spec_section ? `<div class="modal__field"><span class="modal__field-label">Implements SPEC:</span> §${esc(story.spec_section)}</div>` : ''}
          <div class="modal__field"><span class="modal__field-label">Session:</span> ${esc(story.session_id || '--')}</div>
          <div class="modal__field"><span class="modal__field-label">Created:</span> ${esc(story.created_at || '--')}</div>
          <div class="modal__field"><span class="modal__field-label">Updated:</span> ${esc(story.updated_at || '--')}</div>
          ${story.certified_at ? `<div class="modal__field"><span class="modal__field-label">Certified at:</span> ${esc(story.certified_at)}</div>` : ''}
        </div>
      </details>
    `;

    // Wire the Edit button — stays within the modal so we don't flash
    // a re-fetch; the edit form overwrites innerHTML in place.
    const editBtn = document.getElementById('edit-hu-btn');
    if (editBtn) editBtn.addEventListener('click', () => renderStoryEditForm(story));
  } catch (err) {
    content.innerHTML = `<div class="modal__header"><div class="modal__title">Error</div><button class="modal__close" onclick="closeModal()">&times;</button></div><p>${esc(err.message)}</p>`;
  }
}
