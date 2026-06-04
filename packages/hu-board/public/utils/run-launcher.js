// KJC-TSK-0501 step 8f/8 — Preflight gate + run launcher.
//
// Classic script (no exports). Loaded by index.html before app.js so the
// top-level `function`/`let` declarations are hoisted into the shared
// realm and the inline handlers in app.js (and elsewhere) resolve
// `runProject` / `confirmRunWithPreflight` via that hoisting.
//
// Globals consumed from earlier scripts / app.js:
//   - esc()                  (utils/formatters.js)
//   - ensureDialog()         (app.js)
//   - showError()            (utils/modals.js)
//   - renderBoard()          (app.js)
//   - openLogViewer()        (utils/log-panel.js)
//   - lastLaunchedPlanId     (mutable in app.js — assignment crosses
//                             scripts transparently)
//   - lastOpenedLog          (mutable in app.js — same)

// ---- Preflight panel + safety modal ----
//
// Goal: when a non-technical user opens a project, they should see at
// a glance whether the environment is ready (git initialised, remote
// configured, agents installed, Node version, etc.). Each missing
// item is rendered with a plain-Spanish "consequence" so the user
// understands what's at stake.
//
// The panel doubles as the gate for ▶ Run plan / ▶ Run HU: if any
// blocker (status:fail with blocking:true) is present, we refuse to
// launch. If only warnings are present, we open a confirm modal
// listing them and require an explicit "Lanzar de todos modos".

let preflightCache = null;     // memoise per-render so the modal can re-use what the panel already fetched

async function fetchPreflight(projectId) {
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preflight`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function preflightStatusIcon(status) {
  if (status === 'ok') return '✓';
  if (status === 'warn') return '⚠';
  if (status === 'fail') return '✗';
  return 'ℹ';
}
function preflightStatusColor(status) {
  if (status === 'ok') return 'var(--color-green)';
  if (status === 'warn') return 'var(--color-yellow,#eab308)';
  if (status === 'fail') return 'var(--color-red,#ef4444)';
  return 'var(--text-muted)';
}

/**
 * Pre-run safety modal. Returns true if the user wants to proceed,
 * false to cancel. Call BEFORE invoking the run endpoint.
 *
 * Behaviour:
 *   - All green → returns true immediately (no modal).
 *   - Blockers present → modal explains them in plain Spanish; only
 *     "Cancelar" button (no proceed-anyway) because blockers are
 *     known to break the run.
 *   - Only warnings → modal lists them with their consequences and
 *     offers "Cancelar" or "Lanzar de todos modos" (red button so
 *     the user notices they're accepting risk).
 */
async function confirmRunWithPreflight(projectId) {
  const data = preflightCache || await fetchPreflight(projectId);
  if (!data) return true;             // can't fetch → don't block the user
  const blockers = data.blockers || [];
  const warnings = data.warnings || [];
  if (blockers.length === 0 && warnings.length === 0) return true;

  return await new Promise((resolve) => {
    const dlg = document.getElementById('app-dialog') || ensureDialog();
    const isBlocked = blockers.length > 0;
    const headerColor = isBlocked ? 'var(--color-red,#ef4444)' : 'var(--color-yellow,#eab308)';
    const allItems = [...blockers, ...warnings];
    dlg.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:700;display:flex;align-items:center;gap:10px;background:${headerColor};color:#000;">
        <span style="font-size:1.2rem;">${isBlocked ? '✗' : '⚠'}</span>
        <span>${isBlocked ? 'No se puede lanzar — falta algo crítico' : 'Atención antes de lanzar'}</span>
      </div>
      <div style="padding:14px 18px;max-height:60vh;overflow:auto;">
        <p style="margin:0 0 10px;font-size:0.9rem;color:var(--text);">
          ${isBlocked
            ? 'Se detectaron problemas bloqueantes que impedirán que Karajan funcione correctamente:'
            : 'Se detectaron avisos. Karajan puede ejecutarse, pero con limitaciones:'}
        </p>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;">
          ${allItems.map((c) => `
            <li style="padding:8px 10px;background:var(--bg-primary);border-left:3px solid ${preflightStatusColor(c.status)};border-radius:var(--radius-sm);">
              <div style="font-weight:600;color:var(--text);font-size:0.85rem;">
                ${preflightStatusIcon(c.status)} ${esc(c.label)} — <span style="color:var(--text-muted);font-weight:400;">${esc(c.detail || '')}</span>
              </div>
              ${c.consequence ? `<div style="font-size:0.8rem;color:var(--text);margin-top:4px;">${esc(c.consequence)}</div>` : ''}
            </li>
          `).join('')}
        </ul>
      </div>
      <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button id="preflight-cancel" style="padding:8px 16px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;">Cancelar</button>
        ${isBlocked ? '' : `<button id="preflight-proceed" style="padding:8px 16px;background:var(--color-red,#ef4444);border:none;color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;">Lanzar de todos modos</button>`}
      </div>
    `;
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    const cancel = dlg.querySelector('#preflight-cancel');
    const proceed = dlg.querySelector('#preflight-proceed');
    const close = (val) => { try { dlg.close(); } catch { /* ignore */ } resolve(val); };
    cancel?.addEventListener('click', () => close(false), { once: true });
    proceed?.addEventListener('click', () => close(true), { once: true });
    dlg.addEventListener('close', () => resolve(false), { once: true });
  });
}

async function runProject(projectId) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      if (res.status === 404) {
        await showError(
          'The board server does not recognise the "run" endpoint.\n\n'
          + 'Most likely cause: the board process is running a pre-v2.7.5 build. '
          + 'Restart it with:\n\n'
          + '    kj board stop && kj board start',
          { title: 'Board out of date' }
        );
        return;
      }
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'Could not launch run' });
      return;
    }
    const body = await res.json();
    // Best-effort: a chokidar tick may still be in flight, so fetch
    // once explicitly to surface the "running" state without waiting
    // for the watcher debounce.
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();

    // Remember the first successful planId so the section header can
    // offer a "View log" button without the user having to re-launch.
    const firstOk = (body.results || []).find((r) => r.ok);
    if (firstOk && firstOk.planId) {
      lastLaunchedPlanId = firstOk.planId;
      lastOpenedLog = {
        id: firstOk.planId,
        label: 'Run log',
        tailUrl: (offset) => `/api/plans/${encodeURIComponent(firstOk.planId)}/log?offset=${offset}`,
      };
      // Open the log viewer straight away — the user's mental model is
      // "I clicked Run, I want to see what's happening", not "I clicked
      // Run, now where do I look".
      openLogViewer(firstOk.planId);
    } else {
      await showError(
        `Pipeline launched for ${body.launched}/${body.total} plan(s) but `
        + 'no planId came back, so there\'s no log to show.',
        { title: 'Run started' }
      );
    }
  } catch (err) {
    await showError(err.message, { title: 'Could not launch run' });
  }
}
