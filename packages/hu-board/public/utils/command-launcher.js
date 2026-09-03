// KJC-TSK-0501 step 8e/8 — Command launcher modal + log viewer + is-test helper.
//
// Classic script (no exports). Loaded by index.html before app.js so the
// top-level `function` declarations are hoisted into the shared realm —
// the inline event listener on the ⚡ header button (in app.js) and the
// is-test click handler resolve these names via that hoisting.
//
// Globals consumed from earlier scripts / app.js:
//   - esc()                  (utils/formatters.js)
//   - ensureDialog()         (app.js)
//   - showError()            (utils/modals.js)
//   - showConfirm()          (utils/modals.js)
//   - openGenericLogPanel()  (utils/log-panel.js)
//   - lastOpenedLog          (mutable in app.js — assignment crosses
//                             scripts transparently)

// ---- Command launcher modal ----
//
// Opens a small form inside the existing <dialog> singleton with a
// command picker (plan / architect / clean) and the appropriate
// fields per command. Submit POSTs to /api/commands/:command, the
// server spawns a detached `kj` child, and we open the existing log
// viewer (re-uses openLogViewer's tail loop, just pointed at the
// new generic /api/runs/:commandId/log endpoint).


async function showCommandLauncher() {
  const dlg = ensureDialog();
  // Per-command field schemas — kept in the client because each
  // command has different inputs and the modal renders accordingly.
  const SCHEMAS = {
    plan: {
      label: '📋 kj plan',
      help: 'Generate an implementation plan with HUs. Paste the task text OR a file path.',
      fields: [
        { name: 'taskFile', label: 'SPEC file path (absolute)', type: 'text', placeholder: '/home/me/project/SPEC.md' },
        { name: 'task', label: 'OR paste task text directly', type: 'textarea', rows: 6 },
        { name: 'context', label: 'Extra context (optional)', type: 'text' },
        { name: 'projectDir', label: 'Project directory (optional, defaults to board\'s cwd)', type: 'text' },
        { name: 'quick', label: '--quick (skip synth + reviewer)', type: 'checkbox' },
      ],
    },
    architect: {
      label: '🏛 kj architect',
      help: 'Design an architecture and persist ADRs. Same input as kj plan.',
      fields: [
        { name: 'taskFile', label: 'SPEC file path (absolute)', type: 'text', placeholder: '/home/me/project/SPEC.md' },
        { name: 'task', label: 'OR paste task text directly', type: 'textarea', rows: 6 },
        { name: 'context', label: 'Extra context (optional)', type: 'text' },
        { name: 'projectDir', label: 'Project directory (optional)', type: 'text' },
      ],
    },
    clean: {
      label: '🧹 kj clean',
      help: 'Garbage-collect plans / sessions / batches. --nuke wipes everything including the board DB.',
      fields: [
        { name: 'dryRun', label: '--dry-run (just report)', type: 'checkbox' },
        { name: 'nuke', label: '⚠ --nuke (delete everything, including this board\'s DB)', type: 'checkbox' },
      ],
    },
  };

  // Maggle mode (KJC-TSK-0810 AC2): the frequent action leads in plain
  // language — one textarea, clear promise of what will happen. The full
  // technical launcher (file paths, architect, clean) stays one click
  // away behind "Más opciones…".
  const maggle = isMaggleMode();
  let advancedVisible = !maggle;
  if (maggle) {
    SCHEMAS.plan.label = maggleText('launcher.planLabel', SCHEMAS.plan.label);
    SCHEMAS.plan.help = maggleText('launcher.planHelp', SCHEMAS.plan.help);
    SCHEMAS.plan.simpleFields = [
      { name: 'task', label: maggleText('launcher.taskLabel', 'Task'), type: 'textarea', rows: 6 },
    ];
  }

  let active = 'plan';
  const renderForm = () => {
    const s = SCHEMAS[active];
    const visibleFields = (!advancedVisible && s.simpleFields) ? s.simpleFields : s.fields;
    const fields = visibleFields.map((f) => {
      const id = `cmd-field-${f.name}`;
      if (f.type === 'textarea') {
        return `
          <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
            <span style="color:var(--text-muted)">${esc(f.label)}</span>
            <textarea id="${id}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}"
                      style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-family:inherit;font-size:0.9rem;line-height:1.45;resize:vertical"></textarea>
          </label>`;
      }
      if (f.type === 'checkbox') {
        return `
          <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem">
            <input type="checkbox" id="${id}">
            <span>${esc(f.label)}</span>
          </label>`;
      }
      return `
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem">
          <span style="color:var(--text-muted)">${esc(f.label)}</span>
          <input type="text" id="${id}" placeholder="${esc(f.placeholder || '')}"
                 style="padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-size:0.9rem">
        </label>`;
    }).join('');

    dlg.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span>${esc(maggleText('launcher.title', '⚡ Run a Karajan command'))}</span>
        <button id="cmd-close" type="button" class="control-btn"
                style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer">
          ✕
        </button>
      </div>
      <div style="padding:12px 18px;display:flex;gap:8px;border-bottom:1px solid var(--border)">
        ${Object.entries(SCHEMAS).filter(([key]) => advancedVisible || key === 'plan').map(([key, s]) => `
          <button type="button" data-cmd="${key}"
                  style="padding:6px 12px;border:1px solid var(--border);
                         background:${key === active ? 'var(--color-green)' : 'var(--bg-primary)'};
                         color:${key === active ? '#fff' : 'var(--text)'};
                         border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem;font-weight:${key === active ? '600' : '400'}">
            ${esc(s.label)}
          </button>
        `).join('')}
        ${maggle && !advancedVisible ? `
          <button type="button" id="cmd-more"
                  style="margin-left:auto;padding:6px 12px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text-muted);border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem"
                  title="Comandos técnicos: kj plan con ficheros, kj architect, kj clean">
            ${esc(maggleText('launcher.more', 'More…'))}
          </button>
        ` : ''}
      </div>
      <form id="cmd-form" onsubmit="return false"
            style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;width:min(640px, 88vw);box-sizing:border-box">
        <div style="font-size:0.8rem;color:var(--text-muted)">${esc(SCHEMAS[active].help)}</div>
        ${fields}
        <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid var(--border)">
          <button type="button" id="cmd-cancel" class="control-btn"
                  style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer">
            ${esc(maggleText('launcher.cancel', 'Cancel'))}
          </button>
          <button type="button" id="cmd-submit" class="control-btn"
                  style="padding:6px 14px;border:none;background:var(--color-green);color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600">
            ${esc(maggleText('launcher.submit', 'Run'))}
          </button>
        </div>
      </form>
    `;

    dlg.querySelectorAll('[data-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => { active = btn.dataset.cmd; renderForm(); });
    });
    const moreBtn = dlg.querySelector('#cmd-more');
    if (moreBtn) moreBtn.addEventListener('click', () => { advancedVisible = true; renderForm(); });
    dlg.querySelector('#cmd-close').addEventListener('click', () => dlg.close());
    dlg.querySelector('#cmd-cancel').addEventListener('click', () => dlg.close());
    dlg.querySelector('#cmd-submit').addEventListener('click', () => submitCommand(active));
  };

  async function submitCommand(command) {
    const s = SCHEMAS[command];
    const body = {};
    for (const f of s.fields) {
      const el = document.getElementById(`cmd-field-${f.name}`);
      if (!el) continue;
      if (f.type === 'checkbox') body[f.name] = el.checked;
      else {
        const v = (el.value || '').trim();
        if (v) body[f.name] = v;
      }
    }
    // plan / architect: at least one of taskFile or task is required.
    if ((command === 'plan' || command === 'architect') && !body.taskFile && !body.task) {
      await showError(
        maggle ? 'Escribe primero qué quieres pedir — con tus palabras vale.' : 'Provide either a SPEC file path or paste the task text.',
        { title: 'Missing input' }
      );
      return;
    }
    // AC2: before launching, the maggle confirms knowing exactly what
    // will happen — in their language, never a command name alone.
    if (maggle && command === 'plan') {
      const ok = await showConfirm(maggleText('launcher.confirm', ''), {
        title: SCHEMAS.plan.label,
        okLabel: maggleText('launcher.submit', 'Run'),
      });
      if (!ok) return;
    }
    if (command === 'clean' && body.nuke) {
      const ok = await showConfirm(
        '`kj clean --nuke` will delete EVERY plan / session / batch + wipe the HU Board DB. Cannot be undone.',
        { title: 'Confirm --nuke', okLabel: 'Wipe everything', destructive: true }
      );
      if (!ok) return;
    }

    let res, payload;
    try {
      res = await fetch(`/api/commands/${encodeURIComponent(command)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      payload = await res.json().catch(() => ({}));
    } catch (err) {
      await showError(err.message, { title: 'Could not launch command' });
      return;
    }
    if (!res.ok) {
      await showError(payload.error || `HTTP ${res.status}`, { title: 'Command rejected' });
      return;
    }

    dlg.close();
    if (payload.commandId) openCommandLogViewer(command, payload.commandId);
  }

  renderForm();
  dlg.showModal();
}

/**
 * Open the run-log panel pointed at a /api/runs/<commandId>/log
 * tail. Reuses the same panel UI as openLogViewer() for plans —
 * just swaps the URL it polls.
 */
function openCommandLogViewer(commandLabel, commandId) {
  const args = {
    id: commandId,
    label: `kj ${commandLabel}`,
    tailUrl: (offset) => `/api/runs/${encodeURIComponent(commandId)}/log?offset=${offset}`,
  };
  // Remember it so the section header's 📜 View log button can
  // re-open this same log after the user closes the panel.
  lastOpenedLog = args;
  openGenericLogPanel(args);
}

// is_test toggle (KJC-TSK-0371 — board polish #3). Three-state cycle:
//   null (heuristic) → 1 (always test) → 0 (always keep) → null …
// `null` is encoded as the empty string in `data-is-test` so the
// button's HTML serialisation is stable across renders.
function nextIsTestValue(current) {
  // Treat both empty string ("") and "null" as "no override" — the
  // dataset value is the empty string at render time, but URLs and
  // some legacy callers may send the literal "null".
  if (current === '' || current === 'null') return 1;
  if (current === '1') return 0;
  return null;  // from "0" → revert to default
}
