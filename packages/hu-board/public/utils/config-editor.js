// KJC-TSK-0501 step 8d/8 — Config editor modal (kj.config.yml).
//
// Classic script (no exports). Loaded by index.html before app.js so the
// top-level `function` declaration is hoisted into the shared realm and
// the inline `onclick` on the ⚙ header button (and `handleRoute`)
// resolve `showConfigEditor` via that hoisting.
//
// Globals consumed from earlier scripts / app.js:
//   - esc()             (app.js)
//   - ensureDialog()    (app.js)
//   - showError()       (utils/modals.js)

// PR5: kj.config.yml editor modal
//
// Goal: a non-technical user opens the modal, picks "Sonnet siempre"
// from a dropdown, hits "Guardar", and the next `kj run` is cheap.
// No yml editing, no terminal trip.
//
// Each EDITABLE_FIELDS entry the backend exposes becomes one form
// row. `select` → <select>, `boolean` → <input type=checkbox>,
// `number` → <input type=number min/max>. Help text under each
// label as a small grey paragraph.
async function showConfigEditor(scope = 'global') {
  // v2.30.0 PR4 — scope toggle. 'global' edita ~/.karajan/kj.config.yml
  // (afecta a todos los proyectos); 'project' edita
  // <projectDir>/.karajan/kj.config.yml (sólo el repo actual). El backend
  // resuelve <projectDir> desde KJ_PROJECT_DIR || cwd.
  let cfg;
  try {
    const r = await fetch(`/api/config?scope=${encodeURIComponent(scope)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    cfg = await r.json();
  } catch (err) {
    await showError(`No se pudo leer la configuración: ${err.message}`, { title: 'Configuración' });
    return;
  }
  const dlg = document.getElementById('app-dialog') || ensureDialog();
  const renderField = (f) => {
    const id = `cfg-field-${f.key}`;
    let input = '';
    if (f.type === 'select') {
      input = `<select id="${id}" data-key="${esc(f.key)}" style="width:100%;padding:6px 8px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);">
        ${f.options.map((o) => `<option value="${esc(o)}"${o === f.value ? ' selected' : ''}>${esc(o)}</option>`).join('')}
      </select>`;
    } else if (f.type === 'boolean') {
      input = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="${id}" data-key="${esc(f.key)}"${f.value ? ' checked' : ''} style="cursor:pointer;">
        <span style="font-size:0.85rem;color:var(--text-muted);">${f.value ? 'activado' : 'desactivado'}</span>
      </label>`;
    } else if (f.type === 'number') {
      // KJC-BUG-0069 — honour the schema's `step` (e.g. 'any' for floats like
      // rag.search.alpha=0.6). HTML5 number inputs default to step=1, which
      // marks any fractional value as stepMismatch and refuses to commit.
      input = `<input type="number" id="${id}" data-key="${esc(f.key)}" value="${esc(String(f.value))}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${f.step != null ? ` step="${esc(String(f.step))}"` : ''} style="width:120px;padding:6px 8px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);">`;
    }
    return `
      <div style="margin-bottom:14px;">
        <label for="${id}" style="display:block;font-weight:600;color:var(--text);font-size:0.88rem;margin-bottom:4px;">${esc(f.label)}</label>
        ${input}
        ${f.help ? `<p style="margin:4px 0 0;font-size:0.75rem;color:var(--text-muted);">${esc(f.help)}</p>` : ''}
      </div>
    `;
  };

  // v2.30.0 — agrupa los campos por `f.category`. El backend declara
  // las categorías ordenadas en `cfg.categories`; cualquier campo sin
  // categoría cae a "Otros" (defensivo, no se pierde si olvidamos
  // etiquetar uno nuevo). Mantiene el orden interno del whitelist
  // dentro de cada sección.
  const cats = Array.isArray(cfg.categories) && cfg.categories.length > 0
    ? cfg.categories
    : [{ id: 'misc', label: 'Otros', icon: '⚙', order: 999 }];
  const byCat = new Map(cats.map((c) => [c.id, []]));
  byCat.set('misc', byCat.get('misc') || []);
  for (const f of cfg.fields) {
    const id = byCat.has(f.category) ? f.category : 'misc';
    if (!byCat.has(id)) byCat.set(id, []);
    byCat.get(id).push(f);
  }
  const renderSection = (cat) => {
    const fields = byCat.get(cat.id) || [];
    if (fields.length === 0) return '';
    return `
      <section style="margin-bottom:22px;">
        <h3 style="display:flex;align-items:center;gap:8px;margin:0 0 12px;padding-bottom:6px;border-bottom:1px solid var(--border);font-size:0.95rem;font-weight:700;color:var(--text);">
          <span aria-hidden="true">${esc(cat.icon || '⚙')}</span>
          <span>${esc(cat.label)}</span>
        </h3>
        ${fields.map(renderField).join('')}
      </section>
    `;
  };
  const allCats = [...cats];
  if ((byCat.get('misc') || []).length > 0 && !allCats.some((c) => c.id === 'misc')) {
    allCats.push({ id: 'misc', label: 'Otros', icon: '⚙', order: 999 });
  }
  const sectionsHtml = allCats.map(renderSection).join('');

  // PR4 — toggle global / proyecto. Cambiarlo recarga el modal contra el
  // otro fichero. Visual: dos pills mutuamente excluyentes.
  const pill = (id, value, label, active) => `
    <button data-scope="${value}" id="${id}" type="button"
      style="padding:4px 10px;border-radius:999px;border:1px solid var(--border);
      background:${active ? 'var(--color-blue)' : 'var(--bg-primary)'};
      color:${active ? '#fff' : 'var(--text)'};font-size:0.75rem;cursor:pointer;">
      ${esc(label)}
    </button>`;
  const scopeToggle = `
    <div style="display:flex;align-items:center;gap:4px;margin-left:auto;" role="radiogroup" aria-label="Ámbito de configuración">
      ${pill('cfg-scope-global',  'global',  'Global',         scope === 'global')}
      ${pill('cfg-scope-project', 'project', 'Este proyecto',  scope === 'project')}
    </div>`;
  dlg.innerHTML = `
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:700;display:flex;align-items:center;gap:10px;">
      <span style="font-size:1.2rem;">⚙</span>
      <span>Configuración de Karajan</span>
      ${scopeToggle}
    </div>
    <div style="padding:6px 18px 0;font-family:var(--font-mono,monospace);font-size:0.7rem;color:var(--text-muted);">
      ${esc(cfg.path || '')}${cfg.exists === false ? ' · (aún no existe, se creará al guardar)' : ''}
    </div>
    <div style="padding:14px 18px;max-height:65vh;overflow:auto;">
      ${sectionsHtml}
      <p style="margin:14px 0 0;font-size:0.75rem;color:var(--text-muted);">
        Los cambios se guardan en <code>kj.config.yml</code> de forma atómica (con copia de seguridad <code>.bak</code>).
        El próximo <code>kj run</code> los aplicará — no hace falta reiniciar el board.
      </p>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="config-cancel" style="padding:8px 16px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;">Cancelar</button>
      <button id="config-save" style="padding:8px 16px;background:var(--color-green);border:none;color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;">Guardar</button>
    </div>
  `;
  if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
  // PR4 — al cambiar de pill, recargar el modal con el otro scope.
  for (const btn of dlg.querySelectorAll('[data-scope]')) {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-scope');
      if (next === scope) return;
      try { dlg.close(); } catch { /* ignore */ }
      showConfigEditor(next);
    }, { once: true });
  }
  dlg.querySelector('#config-cancel')?.addEventListener('click', () => { try { dlg.close(); } catch { /* ignore */ } }, { once: true });
  dlg.querySelector('#config-save')?.addEventListener('click', async () => {
    // Build the patch from the form, comparing against initial values
    // so we only send what changed.
    const patch = {};
    for (const f of cfg.fields) {
      const el = dlg.querySelector(`[data-key="${f.key}"]`);
      if (!el) continue;
      let v;
      if (f.type === 'boolean') v = el.checked;
      else if (f.type === 'number') v = Number(el.value);
      else v = el.value;
      if (v !== f.value) patch[f.key] = v;
    }
    if (Object.keys(patch).length === 0) {
      try { dlg.close(); } catch { /* ignore */ }
      return;
    }
    try {
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch, scope }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const msg = body?.details?.errors?.length
          ? body.details.errors.join('\n')
          : (body.error || `HTTP ${r.status}`);
        await showError(msg, { title: 'No se pudo guardar' });
        return;
      }
      try { dlg.close(); } catch { /* ignore */ }
    } catch (err) {
      await showError(err.message || String(err), { title: 'Error guardando configuración' });
    }
  }, { once: true });
}
