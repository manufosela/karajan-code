// KJC-TSK-0501 — Modal helpers extracted from app.js (step 2/8).
// Loaded as a classic script before app.js (after formatters.js) — all
// declarations hoist to global scope so app.js consumes them transparently.
// No ES module syntax here on purpose: app.js still has 16+ inline
// `onclick="closeModal()"` handlers that rely on global functions.
//
// Contents:
//   - closeModal(): legacy backdrop modal (#modal-backdrop).
//   - ensureDialog(): singleton <dialog id="app-dialog"> creator.
//   - showError() / showConfirm() / showHelp(): native <dialog> wrappers
//     (project convention forbids alert/confirm/prompt).
//   - Prompt modal: activePromptId state + showPromptModal() +
//     closePromptModalIfMatches() — surface the runner's askQuestion
//     prompts when there's no TTY.
//
// Dependencies: `esc()` from formatters.js (already global) and `fetch`.

function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}

// ---- Native dialog helpers ----
//
// Project convention (and common sense): no window.alert / confirm / prompt.
// These use the browser's built-in modal chrome, steal focus, block script
// execution, and look foreign on every site. We use <dialog> instead —
// same blocking semantics without any of the downsides, and it composes
// with our own CSS variables so it matches the rest of the board.
//
// `showError` is the replacement for alert(); `showConfirm` for confirm().

function ensureDialog() {
  let dlg = document.getElementById('app-dialog');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'app-dialog';
  // Position explicitly: showModal() defaults to centered, but when
  // inner content (a wide textarea, the command launcher's form,
  // etc.) pushes past the dialog's natural width Chrome falls back
  // to top-left. Pinning position+transform here makes centering
  // robust regardless of inner content size. We also reset the
  // browser's default 1em margin on <dialog> which would otherwise
  // offset the transform.
  dlg.style.cssText = [
    'position: fixed',
    'top: 50%',
    'left: 50%',
    'transform: translate(-50%, -50%)',
    'margin: 0',
    'border: 1px solid var(--border)',
    'border-radius: var(--radius-sm)',
    'padding: 0',
    'min-width: 320px',
    'max-width: min(720px, 92vw)',
    'max-height: 90vh',
    'overflow: auto',
    'background: var(--bg-secondary)',
    'color: var(--text)',
    'box-shadow: 0 10px 40px rgba(0,0,0,0.45)',
  ].join(';');
  // Inject a backdrop dim rule once. Inline styles can't target the
  // ::backdrop pseudo-element, so we use a one-off <style> tag.
  if (!document.getElementById('app-dialog-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'app-dialog-style';
    styleEl.textContent =
      '#app-dialog::backdrop { background: rgba(0,0,0,0.55); }';
    document.head.appendChild(styleEl);
  }
  document.body.appendChild(dlg);
  return dlg;
}

function showError(message, opts = {}) {
  return new Promise((resolve) => {
    const dlg = ensureDialog();
    // Maggle mode (KJC-TSK-0810 AC4): plain headline + next step, the raw
    // message demoted to a collapsed technical detail — never alone.
    const maggle = isMaggleMode() ? maggleErrorParts(message) : null;
    const title = maggle ? maggle.headline : (opts.title || 'Error');
    const body = maggle
      ? `${esc(maggle.next)}
         <details style="margin-top:10px"><summary style="cursor:pointer;color:var(--text-muted)">Detalle técnico${opts.title ? ` — ${esc(opts.title)}` : ''}</summary>
           <pre style="white-space:pre-wrap;font-size:0.8rem;color:var(--text-muted);margin:8px 0 0">${esc(maggle.detail)}</pre>
         </details>`
      : esc(message);
    dlg.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);
                  font-weight:600;color:var(--color-red,#ef4444)">
        ${esc(title)}
      </div>
      <div style="padding:16px 18px;font-size:0.9rem;line-height:1.5;
                  white-space:pre-wrap">${body}</div>
      <div style="padding:12px 18px;border-top:1px solid var(--border);
                  text-align:right">
        <button id="app-dialog-ok" class="control-btn"
                style="padding:6px 16px;border:1px solid var(--border);
                       background:var(--bg-primary);color:var(--text);
                       border-radius:var(--radius-sm);cursor:pointer">
          OK
        </button>
      </div>
    `;
    const done = () => {
      if (dlg.open) dlg.close();
      resolve();
    };
    dlg.addEventListener('close', done, { once: true });
    dlg.querySelector('#app-dialog-ok').addEventListener('click', done, { once: true });
    dlg.showModal();
  });
}

function showHelp() {
  return new Promise((resolve) => {
    const dlg = ensureDialog();
    const sections = [
      ['📋 Board',
       'Kanban with every HU of the selected project, grouped by status (Pending → Certified → Done). Click a card to open its detail panel; cards highlight when blocked-by another HU.'],
      ['🌐 Graph',
       'Dependency graph of the selected project — who blocks whom. Useful before scheduling work to spot critical paths or orphan HUs.'],
      ['📊 Dashboard',
       'Per-project landing: stats grid (total / certified / done) + project list. Click a project card to focus the kanban / graph on that project.'],
      ['📚 Sessions',
       'Every kj run that has touched the board, newest first. Filter by project; click a session to inspect its iterations, commits and checkpoints.'],
      ['⚙️ Pipeline',
       'Live observability of pipeline runs (Karajan v2.7+): stage timings, agent calls, decision logs. Opens in a separate page since the data is per-run, not per-project.'],
    ];
    const sectionHtml = sections
      .map(([title, body]) => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="font-weight:600;color:var(--accent-purple);margin-bottom:4px">${esc(title)}</div>
          <div style="font-size:0.85rem;line-height:1.5;color:var(--text-secondary)">${esc(body)}</div>
        </div>`)
      .join('');
    dlg.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:600">
        HU Board — what does each view do?
      </div>
      <div style="padding:8px 18px 4px 18px">${sectionHtml}</div>
      <div style="padding:10px 18px;border-top:1px solid var(--border);
                  font-size:0.78rem;color:var(--text-muted)">
        Tip: hover any tab in the header for ~1 second to see a one-line summary.
      </div>
      <div style="padding:12px 18px;border-top:1px solid var(--border);text-align:right">
        <button id="app-dialog-close" class="control-btn"
                style="padding:6px 16px;border:1px solid var(--border);
                       background:var(--bg-primary);color:var(--text);
                       border-radius:var(--radius-sm);cursor:pointer">
          Close
        </button>
      </div>
    `;
    const done = () => {
      if (dlg.open) dlg.close();
      resolve();
    };
    dlg.addEventListener('close', done, { once: true });
    dlg.querySelector('#app-dialog-close').addEventListener('click', done, { once: true });
    dlg.showModal();
  });
}

function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const dlg = ensureDialog();
    const title = opts.title || 'Confirm';
    const okLabel = opts.okLabel || 'OK';
    const cancelLabel = opts.cancelLabel || 'Cancel';
    const okColor = opts.destructive ? 'var(--color-red,#ef4444)' : 'var(--color-green)';
    dlg.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:600">
        ${esc(title)}
      </div>
      <div style="padding:16px 18px;font-size:0.9rem;line-height:1.5;
                  white-space:pre-wrap">${esc(message)}</div>
      <div style="padding:12px 18px;border-top:1px solid var(--border);
                  display:flex;justify-content:flex-end;gap:8px">
        <button id="app-dialog-cancel" class="control-btn"
                style="padding:6px 14px;border:1px solid var(--border);
                       background:var(--bg-primary);color:var(--text);
                       border-radius:var(--radius-sm);cursor:pointer">
          ${esc(cancelLabel)}
        </button>
        <button id="app-dialog-ok" class="control-btn"
                style="padding:6px 14px;border:none;background:${okColor};
                       color:#fff;border-radius:var(--radius-sm);cursor:pointer">
          ${esc(okLabel)}
        </button>
      </div>
    `;
    let answer = false;
    const finish = () => {
      if (dlg.open) dlg.close();
      resolve(answer);
    };
    dlg.addEventListener('close', finish, { once: true });
    dlg.querySelector('#app-dialog-ok').addEventListener('click', () => { answer = true; finish(); }, { once: true });
    dlg.querySelector('#app-dialog-cancel').addEventListener('click', () => { answer = false; finish(); }, { once: true });
    dlg.showModal();
  });
}

// ---- Prompt modal ----
//
// The runner publishes a prompt JSON file when it needs an answer
// (Solomon escalations, max-iterations decisions, anything wired to
// askQuestion) and there's no TTY to ask through. The board surfaces
// the prompt as a modal dialog with a text input. When the user
// answers, we POST back; the runner sees the answer file and
// resolves.

let activePromptId = null;

function showPromptModal(prompt) {
  if (!prompt?.promptId) return;
  if (activePromptId === prompt.promptId) return;
  activePromptId = prompt.promptId;
  const dlg = ensureDialog();
  // KJC-BUG-0125 (issue #1275): findings render as a readable, open list —
  // "4 findings at severity fail" alone gives the user nothing to act on.
  // Each finding shows its message and the concrete suggestion.
  const sevColor = (s) => (s === 'fail' ? '#f87171' : s === 'warn' ? '#fbbf24' : '#60a5fa');
  const findings = prompt.context?.detail?.findings || prompt.context?.findings;
  const findingsBlock = Array.isArray(findings) && findings.length
    ? `<div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;max-height:280px;overflow:auto">`
      + findings.map((f) => `
        <div style="border-left:3px solid ${sevColor(f.severity)};padding:6px 10px;background:var(--bg-primary);border-radius:var(--radius-sm)">
          <div style="font-size:0.78rem;color:var(--text-muted)">
            <strong style="color:${sevColor(f.severity)}">${esc(String(f.severity || '').toUpperCase())}</strong>
            · ${esc(f.category || '')}${f.id ? ` · ${esc(f.id)}` : ''}
          </div>
          <div style="font-size:0.86rem;line-height:1.45;margin-top:2px">${esc(f.message || '')}</div>
          ${f.suggestion ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">→ ${esc(f.suggestion)}</div>` : ''}
        </div>`).join('')
      + `</div>`
    : '';
  const ctxBlock = prompt.context
    ? `<details style="margin-top:8px">
         <summary style="cursor:pointer;color:var(--text-muted);font-size:0.85rem">Raw context</summary>
         <pre style="white-space:pre-wrap;font-size:0.78rem;background:var(--bg-primary);padding:8px;border-radius:var(--radius-sm);overflow:auto;max-height:240px">${esc(JSON.stringify(prompt.context, null, 2))}</pre>
       </details>`
    : '';
  dlg.innerHTML = `
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-weight:600;display:flex;align-items:center;gap:10px">
      <span>❓ Karajan needs an answer</span>
      ${prompt.sessionId ? `<span style="font-family:var(--font-mono, monospace);font-size:0.75rem;color:var(--text-muted)">${esc(prompt.sessionId)}</span>` : ''}
    </div>
    <div style="padding:14px 18px">
      <div style="white-space:pre-wrap;font-size:0.95rem;line-height:1.55">${esc(prompt.question)}</div>
      ${findingsBlock}
      ${ctxBlock}
      <textarea id="prompt-answer" rows="3"
                placeholder="Type your answer (or 'stop' to abort the run)"
                style="margin-top:12px;width:100%;padding:8px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);font-family:inherit;font-size:0.9rem;line-height:1.5;resize:vertical;box-sizing:border-box"></textarea>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-top:1px solid var(--border);gap:8px">
      <span style="font-size:0.75rem;color:var(--text-muted)">
        The runner is blocked waiting for this answer. Closing the dialog without answering aborts the prompt (run stops).
      </span>
      <div style="display:flex;gap:8px">
        <button id="prompt-stop" type="button" class="control-btn"
                style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer">
          Stop
        </button>
        <button id="prompt-send" type="button" class="control-btn"
                style="padding:6px 14px;border:none;background:var(--color-green);color:#fff;border-radius:var(--radius-sm);cursor:pointer;font-weight:600">
          Send
        </button>
      </div>
    </div>
  `;

  const send = async (rawAnswer) => {
    const answer = String(rawAnswer ?? '');
    try {
      await fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
    } catch (err) {
      await showError(`Could not deliver answer: ${err.message}`, { title: 'Prompt delivery failed' });
      return;
    }
    activePromptId = null;
    if (dlg.open) dlg.close();
  };

  dlg.querySelector('#prompt-send').addEventListener('click', () => {
    send(dlg.querySelector('#prompt-answer').value.trim());
  });
  dlg.querySelector('#prompt-stop').addEventListener('click', () => send('stop'));

  // Esc / backdrop click also count as Stop so the user can't accidentally
  // leave the runner blocked.
  dlg.addEventListener('close', () => {
    if (activePromptId === prompt.promptId) {
      activePromptId = null;
      // Best-effort stop; ignore errors if the runner already moved on.
      fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'stop' }),
      }).catch(() => {});
    }
  }, { once: true });

  dlg.showModal();
  setTimeout(() => dlg.querySelector('#prompt-answer')?.focus(), 50);
}

function closePromptModalIfMatches(promptId) {
  if (activePromptId !== promptId) return;
  activePromptId = null;
  const dlg = document.getElementById('app-dialog');
  if (dlg && dlg.open) dlg.close();
}
