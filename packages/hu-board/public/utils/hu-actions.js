// KJC-TSK-0501 step 8a/8 — HU action handlers (per-card and per-modal actions).
//
// Classic script (no exports). Loaded by index.html before app.js so the
// `window.*` assignments are in place by the time the kanban mounts.
// Inline `onclick="..."` attributes emitted by board-view.js / dashboard-
// view.js / story-detail-view.js resolve these handlers via `window`.
//
// Globals consumed from earlier scripts / app.js:
//   - showConfirm()              (utils/modals.js)
//   - showError()                (utils/modals.js)
//   - closeModal()               (app.js → window.closeModal)
//   - renderBoard()              (app.js)
//   - openGenericLogPanel()      (utils/log-panel.js)
//   - lastOpenedLog              (mutable in app.js — assignment crosses scripts
//                                 transparently because both share the same realm)

/**
 * PR4: launch a single HU from the per-card ▶ button. Confirms with
 * the user (so an accidental click doesn't kick a run) and POSTs to
 * the new /api/hus/:huId/run endpoint, which resolves the planId
 * server-side from the SQLite row.
 *
 * Exposed on `window` because the inline onclick on the card calls it.
 */
window.runSingleHuFromCard = async function runSingleHuFromCard(huId, title) {
  const friendlyTitle = (title || huId).replace(/&#39;/g, "'");
  const ok = await showConfirm(
    `¿Lanzar solo esta HU?\n\n${friendlyTitle}\n\nKarajan ejecutará únicamente esta HU; las demás del plan no se tocarán.`,
    { title: 'Lanzar HU individual', okLabel: 'Lanzar', cancelLabel: 'Cancelar' }
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/hus/${encodeURIComponent(huId)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo lanzar la HU' });
      return;
    }
    const body = await res.json();
    // Surface the log path so the user can tail it from the View log button
    // AND auto-open the viewer so the click produces visible feedback. Without
    // the open, the user clicks Lanzar, sees nothing change, and concludes the
    // run never started — the run IS started, the log IS being written, the
    // UI just wasn't showing it.
    //
    // The tail URL must be derived from body.logPath, not constructed from
    // huId. When `kj run --plan ... --hu <id>` is launched, runPlan writes to
    //   <runsDir>/<planId>--hu-<localHuId>.log
    // — not <runsDir>/hu-<huId>.log. The previous code guessed the wrong
    // filename and the viewer would have hit a non-existent file even if
    // it had been opened.
    if (body.logPath) {
      const logBasename = body.logPath.split('/').pop().replace(/\.log$/, '');
      const tailUrl = (offset) => `/api/runs/${encodeURIComponent(logBasename)}/log?offset=${offset || 0}`;
      lastOpenedLog = { id: `hu-${huId}`, label: `HU ${huId}`, tailUrl };
      openGenericLogPanel({ id: logBasename, label: `HU ${huId}`, tailUrl });
    }
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo al lanzar la HU' });
  }
};

/**
 * KJC-TSK-0394 step 2: devolver una HU al estado `pending` desde
 * cualquier estado no-terminal (coding/reviewing/blocked zombi) o
 * terminal (done/failed) que el usuario quiera relanzar limpio.
 *
 * No tocamos el campo `result`: si una HU acaba en done+fail y el
 * usuario hace Reset → status: pending, result: fail (badge ✗ persiste
 * como historial). El siguiente run sobreescribirá result cuando
 * termine.
 *
 * El backend ya acepta {status: 'pending'} en ALLOWED_STORY_STATUSES
 * (ver routes/api.js); plan-mutations::setHuStatus refleja el cambio
 * al fichero del plan y resincroniza la BBDD.
 */
/**
 * Cambio libre de status desde el dropdown del modal. PATCH al backend
 * con el status nuevo + confirmación (algunos targets como `done` /
 * `failed` son blast-radius alto: no se puede deshacer sin Reset).
 *
 * El propio backend valida que `newStatus` esté en ALLOWED_STORY_
 * STATUSES, así que si el dropdown trae basura el servidor rechaza con
 * 400 — no necesitamos re-validar aquí.
 */
window.changeHuStatusFromModal = async function changeHuStatusFromModal(storyId, newStatus, oldStatus) {
  // Opción "Cambiar a…" placeholder: el usuario abrió el dropdown sin
  // elegir nada. Selecciona el placeholder otra vez para no quedar en
  // un estado ambiguo.
  if (!newStatus) return;
  const select = document.getElementById('hu-status-select');
  const ok = await showConfirm(
    `Cambiar el status de esta HU de "${oldStatus}" a "${newStatus}"?\n\nEl plan file y el board se actualizan al instante. El campo result (badge ✓/✗) se conserva como historial.`,
    { title: 'Cambiar status', okLabel: 'Cambiar', cancelLabel: 'Cancelar' }
  );
  if (!ok) { if (select) select.value = ''; return; }
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo cambiar el status' });
      if (select) select.value = '';
      return;
    }
    closeModal();
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo al cambiar el status' });
    if (select) select.value = '';
  }
};

// KJC-TSK-0406: persist coder_model + reviewer_model overrides from the
// modal. Vacío → null (re-asignación automática por triage en siguiente
// run). Cada modelo es independiente.
window.saveHuModels = async function saveHuModels(storyId) {
  const coderInput = document.getElementById('hu-coder-model');
  const reviewerInput = document.getElementById('hu-reviewer-model');
  const patch = {
    coder_model: coderInput?.value?.trim() || null,
    reviewer_model: reviewerInput?.value?.trim() || null,
  };
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudieron guardar los modelos' });
      return;
    }
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo guardando modelos' });
  }
};

// KJC-PRP-0002 PR6: persist `hu.assignee` (free-form handle of whoever owns
// this HU on a team-shared board). Empty string → null so the API knows to
// clear, not store "". The modal only renders the input when the project is
// `is_shared = 1`, so non-team boards never trigger this path.
window.saveHuAssignee = async function saveHuAssignee(storyId) {
  const input = document.getElementById('hu-assignee');
  const value = input?.value?.trim() || null;
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee: value }),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo guardar el asignado' });
      return;
    }
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo guardando asignado' });
  }
};

// KJC-TSK-0408: deshace los cambios de una HU restaurando el snapshot
// git tomado pre-run. ATENCIÓN: es destructivo (git reset --hard) —
// confirmamos siempre antes de invocar.
window.undoHuChanges = async function undoHuChanges(storyId) {
  const ok = await showConfirm(
    '⚠️ Esta acción es destructiva.\n\nSe descartan los cambios de ficheros que esta HU hizo durante su última ejecución y se restaura el estado pre-run. La HU vuelve a pending y podrás relanzarla con otros modelos.\n\n¿Continuar?',
    { title: 'Deshacer cambios de la HU', okLabel: 'Deshacer', cancelLabel: 'Cancelar' }
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/undo`, { method: 'POST' });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo deshacer la HU' });
      return;
    }
    closeModal();
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo al deshacer la HU' });
  }
};

window.resetHuToPending = async function resetHuToPending(storyId) {
  const ok = await showConfirm(
    '¿Devolver esta HU a pending?\n\nEl estado se cambia a pending y se podrá relanzar. El resultado de la última ejecución (✓/✗/~) se conserva como historial hasta que vuelvas a ejecutarla.',
    { title: 'Reset HU', okLabel: 'Reset', cancelLabel: 'Cancelar' }
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
      await showError(msg, { title: 'No se pudo resetear la HU' });
      return;
    }
    closeModal();
    await fetch('/api/sync', { method: 'POST' }).catch(() => {});
    await renderBoard();
  } catch (err) {
    await showError(err.message || String(err), { title: 'Fallo al resetear la HU' });
  }
};
