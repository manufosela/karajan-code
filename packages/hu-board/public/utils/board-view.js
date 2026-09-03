// KJC-TSK-0501 step 5/8 — Board view (kanban, columns, story card, result helpers).
//
// Classic script. Loaded by index.html after utils/sessions-view.js, before
// app.js. Function declarations hoist to the global scope so app.js (and
// inline onclick handlers) can call them transparently.
//
// Globals consumed from app.js / earlier scripts:
//   - api(), esc(), renderEmptyState(), renderProjectPicker(),
//     renderPreflightPanel(), renderPlanRollup(), confirmRunWithPreflight(),
//     runProject(), openGenericLogPanel(), humaniseProjectName(),
//     resolveProjectMeta(), shortStoryId(), truncate(), scoreClass(),
//     qualityBar(), timeAgo(), showError(), showConfirm(),
//     showStoryDetail(), showOutcomeModal(), runSingleHuFromCard(),
//     renameProjectModal()
//   - mutable: selectedProject, lastOpenedLog, projectNameCache,
//     projectInitialsCache
// All lookups are runtime-bound; load order only needs board-view.js to live
// in the same realm before app.js executes its bootstrap.

/**
 * Renders the kanban board view.
 */
async function renderBoard() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading board...</p></div>';

  try {
    // No project selected → render the project picker instead of
    // mixing every project's HUs in one kanban. The user's
    // complaint: "if no project is selected, show me the list of
    // projects". A mixed kanban hides which HU belongs to which
    // project and is borderline useless on a multi-project setup.
    if (!selectedProject) {
      await renderProjectPicker();
      return;
    }

    const [stories, projectCost] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(selectedProject)}/stories`),
      api(`/api/projects/${encodeURIComponent(selectedProject)}/cost`).catch(() => null),
    ]);
    const costSummary = projectCost ? formatProjectCostSummary(projectCost) : null;
    // Φ0-G (KJC-TSK-0525): aggregated cache-hit badge at the project
    // header, rendered alongside the project cost chip.
    const cacheSummary = projectCost ? formatCacheRatio(projectCost.cachedTokens, projectCost.tokensIn) : null;

    // Pre-resolve project initials + name for every distinct project_id in
    // the fetched stories so `renderStoryCard` is synchronous and the header
    // can show the human-friendly project name (e.g. "Linux Assistant
    // Orchestrator" instead of the raw slug). Cached globally → at most one
    // API round-trip per project over the session.
    const uniqueProjectIds = [...new Set(stories.map((s) => s.project_id))];
    await Promise.all(uniqueProjectIds.map(resolveProjectMeta));
    if (selectedProject && !projectNameCache[selectedProject]) {
      await resolveProjectMeta(selectedProject);
    }
    const projectDisplayName = selectedProject
      ? (projectNameCache[selectedProject] || humaniseProjectName(selectedProject))
      : '';

    // KJC-TSK-0403: status/result ortogonal. 3 columnas (Pending /
    // Running / Done) en vez de 4. Las HUs que fallaron NO van a una
    // columna "Failed" — vuelven a Pending con result=fail y badge ✗.
    // status=failed legacy se trata como pending (migración lazy).
    const columns = {
      pending: stories.filter((s) =>
        ['pending', 'certified', 'needs_context', 'blocked', 'failed'].includes(s.status)
      ),
      running: stories.filter((s) => ['coding', 'reviewing'].includes(s.status)),
      done: stories.filter((s) => s.status === 'done'),
    };

    if (stories.length === 0) {
      app.innerHTML = renderEmptyState();
      return;
    }

    // "Run plan" bulk action: visible when a project is selected AND at
    // least one HU is still awaiting execution AND nothing's currently
    // running (to avoid accidentally launching a second pipeline over a
    // live one). Replaces the old "Mark as certified" button — the
    // intermediate "certified" state was noise from the user's POV.
    const awaitingCount = columns.pending.length;
    const runningCount = columns.running.length;
    const canRun = Boolean(selectedProject) && awaitingCount > 0 && runningCount === 0;
    const isRunning = runningCount > 0;

    // KJC-TSK-0403: 3 canonical lanes. Failed eliminado — HUs con
    // result=fail aparecen en Pending con badge ✗.
    // Maggle mode (KJC-TSK-0810): plain label first, jargon as tooltip.
    const visibleColumns = [
      { title: maggleText('column.pending', 'Pending'), cls: 'pending', rows: columns.pending },
      { title: maggleText('column.running', 'Running'), cls: 'running', rows: columns.running },
      { title: maggleText('column.done', 'Done'), cls: 'done', rows: columns.done },
    ];

    app.innerHTML = `
      <div class="section-header">
        <span class="section-header__title" title="${selectedProject ? esc(selectedProject) : ''}">${maggleText('board.title', 'Story Board')}${selectedProject ? ` - ${esc(projectDisplayName)}` : ''}</span>
        ${selectedProject ? `
          <button class="control-btn project-rename-btn"
                  style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:0.9rem;padding:2px 6px;"
                  title="Renombrar este proyecto"
                  onclick="event.stopPropagation(); window.renameProjectModal('${esc(selectedProject)}', '${esc(projectDisplayName.replace(/'/g, '&#39;'))}');">✎</button>
        ` : ''}
        <span class="section-header__count" title="stories">${stories.length} ${maggleText('board.stories', 'stories')}</span>
        ${costSummary ? `<span class="section-header__cost" title="${esc(costSummary.tooltip)}">💵 ${esc(costSummary.label)}</span>` : ''}
        ${cacheSummary ? `<span class="section-header__cache" title="${esc(cacheSummary.tooltip)}">${esc(cacheSummary.label)}</span>` : ''}
        ${isRunning ? `
          <button id="running-badge-btn" class="section-header__badge"
                style="margin-left:auto;padding:4px 10px;font-size:0.8rem;background:var(--color-yellow,#eab308);color:#000;border-radius:var(--radius-sm);font-weight:600;border:none;cursor:pointer;"
                title="Abrir el log de la HU en marcha">
            ⚙ ${runningCount} ${maggleText('board.running', 'running')}…
          </button>
          <button id="stop-run-btn" class="control-btn"
                style="padding:4px 10px;font-size:0.8rem;background:var(--color-red,#ef4444);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;"
                title="${maggleText('board.stopTitle', 'Abortar todos los kj run en marcha de este proyecto (SIGTERM con escalado a SIGKILL tras 5s)')}">
            ${maggleText('board.stop', '⏹ Stop')}
          </button>
        ` : ''}
        ${lastOpenedLog ? `
          <button class="control-btn" id="view-log-btn"
                  style="${isRunning ? '' : 'margin-left:auto;'}padding:6px 12px;font-size:0.85rem;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);cursor:pointer;"
                  title="Re-open the log of the most recent run/command">
            ${maggleText('board.viewLog', '📜 View log')}
          </button>
        ` : ''}
        ${canRun ? `
          <button class="control-btn" id="run-plan-btn"
                  style="margin-left:auto;padding:6px 14px;font-size:0.9rem;background:var(--color-green);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;"
                  title="${maggleText('board.runTitle', 'Launch kj run --plan over every plan in this project')}">
            ${maggleText('board.run', '▶ Run plan')} (${awaitingCount} ${maggleText('board.story', 'HU')}${awaitingCount === 1 ? '' : 's'})
          </button>
        ` : ''}
      </div>
      <div id="preflight-panel" class="preflight-panel" style="margin:8px 0;">
        <div class="preflight-panel__loading" style="font-size:0.8rem;color:var(--text-muted);padding:6px 10px;">
          Comprobando estado del proyecto…
        </div>
      </div>
      <div id="rag-panel" class="rag-panel" style="margin:8px 0;display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;">
        <input id="rag-query" type="text" placeholder="${maggleText('board.ragPlaceholder', "🔍 RAG search: ask anything about this project's plans / onboarding / code…")}"
               style="flex:1;min-width:260px;padding:6px 10px;font-size:0.85rem;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);" />
        <select id="rag-scope" style="padding:6px 10px;font-size:0.85rem;background:var(--bg-primary);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);">
          <option value="all">All</option><option value="plans">Plans</option><option value="onboarding">Onboarding</option><option value="code">Code</option>
        </select>
        <button id="rag-search-btn" class="control-btn"
                style="padding:6px 12px;font-size:0.85rem;background:var(--color-blue,#3b82f6);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;">
          Search
        </button>
        <div id="rag-results" style="flex-basis:100%;font-size:0.8rem;color:var(--text-muted);"></div>
      </div>
      <div id="plan-rollup-banner"></div>
      <div class="kanban">
        ${visibleColumns.map((c) => renderKanbanColumn(c.title, c.cls, c.rows)).join('')}
      </div>
    `;

    if (canRun) {
      document.getElementById('run-plan-btn').addEventListener('click', async () => {
        // Pre-run safety: ask preflight if anything risky is missing
        // (no remote, dirty tree, missing agents, etc.). The modal
        // shows blockers + warnings in plain Spanish and the user
        // can cancel or proceed anyway. If everything is green we
        // skip the modal and run straight away.
        const ok = await confirmRunWithPreflight(selectedProject);
        if (!ok) return;
        await runProject(selectedProject);
      });
    }
    // Preflight panel is rendered AFTER the kanban so we can fetch
    // it without blocking the initial paint. Replaces a placeholder
    // div in-place (no full re-render).
    renderPreflightPanel(selectedProject).catch(() => {});
    // PR3: render the plan-level rollup banner if any plan in this
    // project has a stamped outcome. Non-blocking — if it fails the
    // user just doesn't see the banner.
    renderPlanRollup(selectedProject).catch(() => {});
    const viewLogBtn = document.getElementById('view-log-btn');
    if (viewLogBtn && lastOpenedLog) {
      viewLogBtn.addEventListener('click', () => openGenericLogPanel({
        id: lastOpenedLog.id,
        label: lastOpenedLog.label,
        tailUrl: lastOpenedLog.tailUrl,
      }));
    }
    // Wire the yellow "⚙ N running…" badge so it opens the live log of the
    // first running HU. Without this the badge was decorative — and if the
    // run was started before the current page load (refresh / new browser
    // session) `lastOpenedLog` is null, so the "📜 View log" button isn't
    // even rendered. Then the user has no way to see the live output.
    //
    // For a single-HU run the log lives at:
    //   ~/.karajan/hu-board-runs/<planId>--hu-<localHuId>.log
    // which the /api/runs/:commandId/log endpoint serves when commandId
    // matches the basename. The composite id stored in SQLite is
    // "<projectId>::<localHuId>", so we strip the prefix to derive
    // localHuId and concatenate with plan_id (already on the story row).
    const runningBadgeBtn = document.getElementById('running-badge-btn');
    if (runningBadgeBtn) {
      runningBadgeBtn.addEventListener('click', async () => {
        const running = stories.find((s) => s.status === 'coding' || s.status === 'reviewing');
        if (!running) return;
        const planId = running.plan_id;
        if (!planId) {
          await showError('Esta HU no tiene plan_id asociado, no puedo localizar su log.', { title: 'Sin log' });
          return;
        }
        const localHuId = running.id.includes('::') ? running.id.split('::').pop() : running.id;
        const logBasename = `${planId}--hu-${localHuId}`;
        const tailUrl = (offset) => `/api/runs/${encodeURIComponent(logBasename)}/log?offset=${offset || 0}`;
        lastOpenedLog = { id: logBasename, label: `HU ${localHuId}`, tailUrl };
        openGenericLogPanel({ id: logBasename, label: `HU ${localHuId}`, tailUrl });
      });
    }

    // KJC-TSK-0396: botón ⏹ Stop. Abortar todos los kj run vivos del
    // proyecto. Si hay múltiples planes corriendo (caso raro pero
    // posible), itera sobre cada planId único de las HUs running.
    const stopRunBtn = document.getElementById('stop-run-btn');
    if (stopRunBtn) {
      stopRunBtn.addEventListener('click', async () => {
        const runningHus = stories.filter((s) => s.status === 'coding' || s.status === 'reviewing');
        const planIds = [...new Set(runningHus.map((s) => s.plan_id).filter(Boolean))];
        if (planIds.length === 0) {
          await showError('No hay plan_id asociado a las HUs en marcha.', { title: 'Sin runs' });
          return;
        }
        const ok = await showConfirm(
          `Esto matará ${planIds.length === 1 ? 'el proceso' : `los ${planIds.length} procesos`} del orquestador en marcha y dejará las HUs en curso (coding/reviewing) en pending para que puedas relanzarlas.\n\n¿Seguro?`,
          { title: 'Abortar kj run', okLabel: 'Stop', cancelLabel: 'Cancelar', destructive: true }
        );
        if (!ok) return;
        const summaries = [];
        for (const planId of planIds) {
          try {
            const res = await fetch(`/api/runs/${encodeURIComponent(planId)}/stop`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
            });
            const body = await res.json();
            if (!res.ok) summaries.push(`${planId}: error ${body.error || res.status}`);
            else summaries.push(`${planId}: ${body.stopped} SIGTERM, ${body.killed} SIGKILL, ${body.hu_reset_count || 0} HUs → pending`);
          } catch (err) {
            summaries.push(`${planId}: ${err.message}`);
          }
        }
        await fetch('/api/sync', { method: 'POST' }).catch(() => {});
        await renderBoard();
        if (summaries.some((s) => s.includes('SIGKILL') && !s.startsWith('0 ')) && summaries.some((s) => /\b[1-9]\d* SIGKILL/.test(s))) {
          await showError(
            `Algún proceso no respondió a SIGTERM en 5s y fue forzado con SIGKILL:\n\n${summaries.join('\n')}`,
            { title: 'Forzado con SIGKILL' }
          );
        }
      });
    }

    // RAG search panel (KJC-PCS-0049 Step 8) — input + scope + render hits.
    const ragInput = document.getElementById('rag-query');
    const ragScope = document.getElementById('rag-scope');
    const ragBtn = document.getElementById('rag-search-btn');
    const ragResults = document.getElementById('rag-results');
    async function runRagSearch() {
      const text = ragInput?.value?.trim();
      if (!text) return;
      ragResults.innerHTML = '<em>Searching…</em>';
      try {
        const res = await fetch('/api/rag/query', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, topK: 5, scope: ragScope?.value || 'all' }),
        });
        const body = await res.json();
        if (!res.ok) { ragResults.innerHTML = `<span style="color:var(--color-red);">Error: ${esc(body.error || res.status)}</span>`; return; }
        if (body.empty) { ragResults.innerHTML = '<em>No chunks indexed yet. Run <code>kj rag index</code> in this project\'s terminal first.</em>'; return; }
        if (body.hits.length === 0) { ragResults.innerHTML = '<em>No hits.</em>'; return; }
        ragResults.innerHTML = body.hits.map((h) => {
          const label = h.metadata?.hu_id || h.metadata?.symbol || h.metadata?.headingPath?.join(' > ') || 'block';
          const snippet = h.text.length > 240 ? `${esc(h.text.slice(0, 240))}…` : esc(h.text);
          return `<div style="border-left:3px solid var(--color-blue,#3b82f6);padding:6px 10px;margin:6px 0;background:var(--bg-primary);">
            <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px;">[${esc(h.kind)} · ${esc(label)} · score=${h.score.toFixed(4)}] ${esc(h.source)}</div>
            <div style="font-size:0.85rem;white-space:pre-wrap;">${snippet}</div>
          </div>`;
        }).join('');
      } catch (err) {
        ragResults.innerHTML = `<span style="color:var(--color-red);">Error: ${esc(err.message)}</span>`;
      }
    }
    ragBtn?.addEventListener('click', runRagSearch);
    ragInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runRagSearch(); });
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
  // Empty lanes render the header (so the user keeps the 4-column
  // mental map) but no body placeholder — "No stories" text on four
  // empty columns was noise on fresh plans.
  return `
    <div class="kanban__column kanban__column--${cssClass}" data-column="${cssClass}"${stories.length === 0 ? ' style="opacity:0.55"' : ''}>
      <div class="kanban__column-header">
        <span class="kanban__column-title" title="${cssClass}">${title}</span>
        <span class="kanban__column-count" data-column-count>${stories.length}</span>
      </div>
      ${stories.map(renderStoryCard).join('')}
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
  // Prefer denormalised counters stamped at sync time; fall back to
  // parsing the JSON blob for pre-migration rows so the card still shows
  // the AC count without a board DB nuke.
  const acCount = typeof story.ac_count === 'number'
    ? story.ac_count
    : (story.acceptance_criteria ? JSON.parse(story.acceptance_criteria).length : 0);
  const testCount = typeof story.test_count === 'number' ? story.test_count : 0;
  const blockedBy = story.blocked_by ? JSON.parse(story.blocked_by) : [];
  const initials = projectInitialsCache[story.project_id] || 'kj';
  const shortId = shortStoryId(story, initials);

  // Human-readable dep list: `lao-001, lao-003` instead of the raw HU ids.
  const shortDep = (depId) => {
    const m = /_(\d+)(?!.*\d)/.exec(depId);
    return `${initials}-${m ? m[1] : '?'}`;
  };

  // Tests-first flag: a HU with zero acceptance_tests has no contract
  // for the coder, so `Run plan` will refuse to execute it. Surface
  // this on the card so the user edits the HU before trying to run.
  const missingTestContract = testCount === 0 && ['pending', 'certified'].includes(story.status);

  // PR4: per-HU ▶ Run button. Visible when:
  //   - the HU is in a re-runnable lifecycle state (certified / failed /
  //     pending / done — KJC-TSK-0394 step 2 adds `done` so the user can
  //     replay a HU whose `result` was fail or partial without having to
  //     "reset to pending" first) AND
  //   - it has at least one acceptance test (otherwise the run would
  //     refuse) AND
  //   - it isn't currently coding/reviewing AND
  //   - KJC-BUG-0048: it has no unresolved blocked_by deps. The card
  //     already shows "⏳ waits for: ..." below the title; the ▶ button
  //     must match that gating or the user can launch a HU whose deps
  //     don't exist yet, hitting the missing-prereq path at runtime.
  const canRunHu = ['certified', 'failed', 'pending', 'done'].includes(story.status)
    && testCount > 0
    && !['coding', 'reviewing'].includes(story.status)
    && blockedBy.length === 0;

  return `
    <div class="story-card" data-story-id="${esc(story.id)}" data-status="${esc(story.status || 'pending')}" onclick="showStoryDetail('${esc(story.id)}')">
      <div class="story-card__id" title="${esc(story.id)}">
        ${esc(shortId)}
        ${canRunHu ? `
          <button class="story-card__run-btn"
                  style="float:right;padding:1px 6px;font-size:0.7rem;background:var(--color-green);color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;"
                  title="Lanzar solo esta HU"
                  onclick="event.stopPropagation(); window.runSingleHuFromCard('${esc(story.id)}', '${esc(title.replace(/'/g, '&#39;'))}');">▶</button>
        ` : ''}
      </div>
      <div class="story-card__title">${esc(truncate(title, 100))}</div>
      <div class="story-card__meta" style="gap:10px">
        ${acCount > 0 ? `<span title="${acCount} acceptance criteria">📋 ${acCount} AC${acCount === 1 ? '' : 's'}</span>` : ''}
        ${testCount > 0 ? `<span title="${testCount} acceptance tests declared">✅ ${testCount} test${testCount === 1 ? '' : 's'}</span>` : ''}
        ${story.spec_section ? `<span title="Implements SPEC ${esc(story.spec_section)}" style="font-family:var(--font-mono, monospace)">📖 §${esc(story.spec_section)}</span>` : ''}
        ${story.quality_total !== null ? `
          <span class="story-card__score ${scoreClass(story.quality_total)}" title="INVEST score">
            ${story.quality_total}/60 ${qualityBar(story.quality_total)}
          </span>
        ` : ''}
        ${(() => {
          const c = formatCost(story.cost_usd);
          return c ? `<span class="story-card__cost" title="${esc(c.tooltip)}">💵 ${esc(c.label)}</span>` : '';
        })()}
        ${(() => {
          // Φ0-G (KJC-TSK-0525): per-HU cache hit badge. Rendered next to
          // the cost so users can correlate "this run cost $X and 73% of
          // input was served from cache" in one glance.
          const r = formatCacheRatio(story.cached_tokens, story.tokens_in);
          return r ? `<span class="story-card__cache" title="${esc(r.tooltip)}">${esc(r.label)}</span>` : '';
        })()}
      </div>
      ${missingTestContract ? `
        <div class="story-card__meta" style="margin-top:4px;font-size:0.75rem;color:var(--color-yellow,#eab308);font-weight:600" title="This HU has no acceptance_tests declared — Run plan will reject it until you add at least one.">
          ⚠ missing test contract
        </div>
      ` : ''}
      ${blockedBy.length > 0 ? `
        <div class="story-card__meta" style="margin-top:4px;font-size:0.75rem;color:var(--text-muted)" title="This HU waits on: ${esc(blockedBy.join(', '))}">
          ⏳ waits for: ${blockedBy.map((d) => esc(shortDep(d))).join(', ')}
        </div>
      ` : (story.status === 'pending' || story.status === 'certified') && !missingTestContract ? `
        <div class="story-card__meta" style="margin-top:4px;font-size:0.75rem;color:var(--color-green)" title="No dependencies — runs first on the next 'Run plan'">
          🟢 ready to run
        </div>
      ` : ''}
      ${antipatterns.length > 0 ? `<div class="story-card__antipattern">${antipatterns.map((a) => esc(a)).join(', ')}</div>` : ''}
      <div class="story-card__meta" style="margin-top:6px">
        <span class="story-card__status status--${story.status}">${esc(story.status)}</span>
        ${renderResultBadge(computeEffectiveResult(story))}
        <span class="story-card__time">${timeAgo(story.updated_at)}</span>
        ${renderOutcomeChip(story.outcome)}
      </div>
    </div>
  `;
}

/**
 * KJC-TSK-0394 step 5: result "efectivo" para la UI. Sobre el campo
 * persistido `story.result` (si existe), o inferido del status legacy
 * (done→pass, failed→fail).
 */
function computeEffectiveResult(story) {
  if (!story) return null;
  if (story.result !== undefined && story.result !== null) return story.result;
  if (story.status === 'done') return 'pass';
  if (story.status === 'failed') return 'fail';
  return null;
}

/**
 * Render the per-HU `result` badge. Ortogonal al status.
 * @param {string|null} result
 * @returns {string} HTML
 */
function renderResultBadge(result) {
  if (!result) return '';
  const icons = { pass: '✓', fail: '✗', partial: '~' };
  const titles = {
    pass: 'Última ejecución: todos los tests pasaron',
    fail: 'Última ejecución: falló',
    partial: 'Última ejecución: pasó parcialmente',
  };
  const icon = icons[result];
  if (!icon) return '';
  return `<span class="story-card__result result--${esc(result)}" title="${esc(titles[result])}">${icon}</span>`;
}

/**
 * Render the per-HU outcome chip (📄 resumen). Tolerates both string and
 * object shapes.
 * @param {string|object|null} outcome
 * @returns {string} HTML
 */
function renderOutcomeChip(outcome) {
  if (!outcome) return '';
  let parsed;
  try { parsed = typeof outcome === 'string' ? JSON.parse(outcome) : outcome; }
  catch { return ''; }
  if (!parsed || typeof parsed !== 'object') return '';
  const summary = parsed.summary || `Resultado: ${parsed.status || 'desconocido'}`;
  return `
    <span class="story-card__outcome-chip"
          style="margin-left:auto;padding:2px 8px;font-size:0.7rem;background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;color:var(--text-muted);"
          title="${esc(summary)}"
          onclick="event.stopPropagation(); showOutcomeModal('${esc(JSON.stringify(parsed).replace(/'/g, '&#39;'))}');">
      📄 resumen
    </span>
  `;
}
