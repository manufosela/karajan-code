// KJC-TSK-0501 step 8c/8 — Story edit form (inline editor for the HU modal).
//
// Classic script (no exports). Loaded by index.html before app.js so the
// top-level `function` declarations are hoisted into the shared realm and
// `showStoryDetail` (story-detail-view.js) can call `renderStoryEditForm`
// when the user hits ✎ on a story.
//
// Globals consumed from earlier scripts / app.js:
//   - esc()                  (app.js)
//   - shortStoryId()         (utils/formatters.js)
//   - projectInitialsCache   (mutable in app.js — assignment crosses
//                             scripts transparently)
//   - showStoryDetail()      (utils/story-detail-view.js)
//   - showError()            (utils/modals.js)
//   - closeModal()           (app.js → window.closeModal, used by
//                             inline onclick on the modal close button)
//   - renderBoard()          (app.js)

/**
 * Swap the story modal into an inline edit form. Accepts the full story
 * record that `showStoryDetail` just rendered so we don't re-fetch —
 * the user's intent is "edit what I'm looking at".
 *
 * Cancel restores the read-only view via `showStoryDetail`; Save posts a
 * PATCH and, on success, re-opens in read-only with the refreshed row.
 *
 * @param {object} story
 */
function renderStoryEditForm(story) {
  const content = document.getElementById('modal-content');
  const initials = projectInitialsCache[story.project_id] || 'kj';
  const shortId = shortStoryId(story, initials);

  const rawAc = story.acceptance_criteria ? JSON.parse(story.acceptance_criteria) : [];
  // Represent AC as text: plain strings go verbatim, Gherkin objects
  // collapse to "Given … | When … | Then …". On save we parse back —
  // if the line matches the pattern we treat it as Gherkin, otherwise
  // a free-form string.
  const acInitial = rawAc
    .map((c) => typeof c === 'string' ? c : (c.given ? `Given ${c.given} | When ${c.when} | Then ${c.then}` : JSON.stringify(c)))
    .join('\n');

  // Tests-first editor: one block per test with a type selector
  // (shell | gherkin), the content textarea, optional file path, and
  // a remove button. Save collects them into the structured v2.7.5
  // array shape. Plain strings in the existing data are treated as
  // legacy shell tests and auto-upgraded to the structured form.
  const rawTests = story.acceptance_tests ? JSON.parse(story.acceptance_tests) : [];
  const testsInitial = rawTests.map((t) => {
    if (typeof t === 'string') return { type: 'shell', content: t, file: '' };
    if (t && typeof t === 'object') {
      return {
        type: t.type === 'gherkin' ? 'gherkin' : 'shell',
        content: typeof t.content === 'string' ? t.content : JSON.stringify(t),
        file: typeof t.file === 'string' ? t.file : '',
      };
    }
    return { type: 'shell', content: String(t ?? ''), file: '' };
  });

  const scopeInitial = story.original_text || story.certified_want || '';
  const TASK_TYPES = ['sw', 'infra', 'doc', 'add-tests', 'refactor'];

  content.innerHTML = `
    <div class="modal__header">
      <div>
        <div class="modal__title" title="${esc(story.id)}">${esc(shortId)} <span style="font-size:0.75rem;color:var(--text-muted);font-weight:normal">(editing)</span></div>
        <div class="modal__subtitle" style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;margin-top:2px">${esc(story.id)}</div>
      </div>
      <button class="modal__close" onclick="closeModal()">&times;</button>
    </div>

    <form id="hu-edit-form" onsubmit="return false" style="display:flex;flex-direction:column;gap:14px;padding:8px 0">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
        <span style="color:var(--text-muted)">Title</span>
        <input type="text" id="edit-title" value="${esc(story.title || '')}"
               style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-size:0.95rem"
               maxlength="200" required>
      </label>

      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
        <span style="color:var(--text-muted)">Scope</span>
        <textarea id="edit-scope" rows="4"
                  style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-family:inherit;font-size:0.9rem;line-height:1.5;resize:vertical">${esc(scopeInitial)}</textarea>
      </label>

      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
        <span style="color:var(--text-muted)">Task type</span>
        <select id="edit-task-type"
                style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-size:0.9rem">
          ${TASK_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </label>

      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
        <span style="color:var(--text-muted)">
          Acceptance criteria — one per line.
          Gherkin: <code>Given X | When Y | Then Z</code>
        </span>
        <textarea id="edit-ac" rows="6"
                  style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-family:var(--font-mono, monospace);font-size:0.85rem;line-height:1.5;resize:vertical">${esc(acInitial)}</textarea>
      </label>

      <fieldset style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;margin:0">
        <legend style="color:var(--text-muted);font-size:0.85rem;padding:0 6px">
          Acceptance tests — the contract the coder must satisfy
        </legend>
        <div id="edit-tests-list" style="display:flex;flex-direction:column;gap:8px"></div>
        <button type="button" id="edit-tests-add"
                style="margin-top:8px;padding:4px 10px;font-size:0.8rem;background:var(--bg-primary);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer">
          + Add test
        </button>
      </fieldset>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">
        <button type="button" id="edit-cancel" class="control-btn"
                style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer">
          Cancel
        </button>
        <button type="button" id="edit-save" class="control-btn"
                style="padding:6px 14px;border:none;background:var(--color-green);color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600">
          Save
        </button>
      </div>
    </form>
  `;

  // Tests editor state + renderers. Kept on the function scope (not
  // on window) so reopening the form gives a fresh copy.
  let testRows = [...testsInitial];
  const listEl = document.getElementById('edit-tests-list');

  function renderTestsEditor() {
    listEl.innerHTML = testRows.map((t, i) => `
      <div class="edit-test-row" data-idx="${i}"
           style="display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:start;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-primary)">
        <select data-field="type"
                style="padding:4px 6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);border-radius:var(--radius-sm);font-size:0.8rem">
          <option value="shell"${t.type === 'shell' ? ' selected' : ''}>shell</option>
          <option value="gherkin"${t.type === 'gherkin' ? ' selected' : ''}>gherkin</option>
        </select>
        <div style="display:flex;flex-direction:column;gap:4px">
          <textarea data-field="content" rows="${t.type === 'gherkin' ? 3 : 2}"
                    placeholder="${t.type === 'gherkin' ? 'Given …\\nWhen …\\nThen …' : 'npx vitest run test/foo.test.js'}"
                    style="padding:6px 8px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);border-radius:var(--radius-sm);font-family:var(--font-mono, monospace);font-size:0.82rem;line-height:1.4;resize:vertical">${esc(t.content)}</textarea>
          <input type="text" data-field="file" placeholder="Optional: file path (e.g. tests/login.test.ts)" value="${esc(t.file || '')}"
                 style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);border-radius:var(--radius-sm);font-family:var(--font-mono, monospace);font-size:0.75rem">
        </div>
        <button type="button" data-field="remove" title="Remove this test"
                style="align-self:start;padding:4px 8px;background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:var(--radius-sm);cursor:pointer;font-size:0.8rem">✕</button>
      </div>
    `).join('');

    // Bind the edit events. We re-bind on every render — cheap, and
    // keeps the state → DOM mapping simple.
    listEl.querySelectorAll('.edit-test-row').forEach((row) => {
      const idx = Number(row.dataset.idx);
      row.querySelector('[data-field="type"]').addEventListener('change', (e) => {
        testRows[idx].type = e.target.value;
        renderTestsEditor();            // re-render so placeholder updates
      });
      row.querySelector('[data-field="content"]').addEventListener('input', (e) => {
        testRows[idx].content = e.target.value;
      });
      row.querySelector('[data-field="file"]').addEventListener('input', (e) => {
        testRows[idx].file = e.target.value;
      });
      row.querySelector('[data-field="remove"]').addEventListener('click', () => {
        testRows.splice(idx, 1);
        renderTestsEditor();
      });
    });
  }

  renderTestsEditor();

  document.getElementById('edit-tests-add').addEventListener('click', () => {
    testRows.push({ type: 'shell', content: '', file: '' });
    renderTestsEditor();
  });

  document.getElementById('edit-cancel').addEventListener('click', () => showStoryDetail(story.id));
  document.getElementById('edit-save').addEventListener('click', () => saveStoryEdits(story, () => testRows));
}

/**
 * Collect the form values, compute the diff against the story as it
 * was on modal open, and PATCH only the changed fields. Empty diff is
 * a no-op (close out of edit mode without an API call).
 * @param {object} story
 */
async function saveStoryEdits(story, getTestRows) {
  const title = document.getElementById('edit-title').value.trim();
  const scope = document.getElementById('edit-scope').value;
  const taskType = document.getElementById('edit-task-type').value;
  const acRaw = document.getElementById('edit-ac').value;

  if (!title) {
    await showError('Title cannot be empty.', { title: 'Invalid input' });
    return;
  }

  // Parse AC: one per line; a line with "Given X | When Y | Then Z"
  // (case-insensitive) becomes Gherkin; everything else stays a string.
  // Blank lines are dropped.
  const acceptance_criteria = acRaw.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^Given\s+(.*?)\s*\|\s*When\s+(.*?)\s*\|\s*Then\s+(.*)$/i.exec(line);
      if (m) return { given: m[1].trim(), when: m[2].trim(), then: m[3].trim() };
      return line;
    });

  // Collect the structured acceptance_tests from the editor state,
  // dropping rows the user left empty.
  const testRows = typeof getTestRows === 'function' ? getTestRows() : [];
  const acceptance_tests = testRows
    .map((t) => ({
      type: t.type === 'gherkin' ? 'gherkin' : 'shell',
      content: (t.content || '').trim(),
      file: (t.file || '').trim(),
    }))
    .filter((t) => t.content.length > 0)
    .map((t) => (t.file ? t : { type: t.type, content: t.content }));

  // Diff against the original so we don't send untouched fields and
  // let the server's COALESCE keep existing values.
  const patch = {};
  const originalScope = story.original_text || story.certified_want || '';
  if (title !== (story.title || '')) patch.title = title;
  if (scope !== originalScope) patch.scope = scope;
  if (taskType && taskType !== 'sw') patch.task_type = taskType;
  const prevAcStr = story.acceptance_criteria || '[]';
  const nextAcStr = JSON.stringify(acceptance_criteria);
  if (nextAcStr !== prevAcStr) patch.acceptance_criteria = acceptance_criteria;
  const prevTestsStr = story.acceptance_tests || '[]';
  const nextTestsStr = JSON.stringify(acceptance_tests);
  if (nextTestsStr !== prevTestsStr) patch.acceptance_tests = acceptance_tests;

  if (Object.keys(patch).length === 0) {
    showStoryDetail(story.id);
    return;
  }

  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(story.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      if (res.status === 404) {
        await showError(
          'The board server does not recognise the extended PATCH endpoint.\n\n'
          + 'Restart it to pick up v2.7.5+:\n\n'
          + '    kj board stop && kj board start',
          { title: 'Board out of date' }
        );
        return;
      }
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'Could not save HU' });
      return;
    }
    await renderBoard();               // card shows new title/counts
    await showStoryDetail(story.id);   // reopen modal with fresh data
  } catch (err) {
    await showError(err.message, { title: 'Could not save HU' });
  }
}
