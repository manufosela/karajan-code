// GUI-B (KJC-TSK-0772) — Governance view: the "acta". A live exception is
// invisible; here every rule shows its friction, every grant its owner and
// expiry, every renewal its count. Read-only (actions land in GUI-C).
// Classic script (no exports), same conventions as dashboard-view.js:
// api() from utils/api.js, esc() from formatters.js.

const GOV_DIR_KEY = 'kj.governance.dir';
let govBusy = false;

async function renderGovernance() {
  const app = document.getElementById('app');
  // Server-push re-renders the current view on every event; never wipe a
  // form the user is typing in or a proposal still being translated.
  const typing = () => { const a = document.activeElement; return govBusy || Boolean(a && a.id && a.id.startsWith('gov-') && app.contains(a)); };
  if (typing()) return;
  const dir = localStorage.getItem(GOV_DIR_KEY) || '';
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading governance...</p></div>';
  try {
    const data = await api('/api/governance' + (dir ? '?dir=' + encodeURIComponent(dir) : ''));
    if (typing()) return; // the user started typing while we fetched: keep their form
    if (!data || data.ok === false) {
      app.innerHTML = govDirForm((data && data.dir) || dir) + `<div class="empty-state"><div class="empty-state__title">Governance unavailable</div><div class="empty-state__text">${esc((data && data.error) || 'governance unavailable')}</div><div class="empty-state__path">Type the absolute directory of a project that ran <code>kj harden</code> and press Load.</div></div>`;
      return;
    }
    localStorage.setItem(GOV_DIR_KEY, data.dir);
    app.innerHTML = govDirForm(data.dir) + govIdentity(data.identity) + govChain(data.report, data.anchor) + govRules(data.policy, data.report) + govGrants(data.report.grants, data.policy) + govSignals(data.report.signals);
  } catch (err) {
    app.innerHTML = govDirForm(dir) + `<div class="empty-state"><div class="empty-state__title">Governance unavailable</div><div class="empty-state__text">${esc(err.message)}</div></div>`;
  }
}

function govSetDir() {
  localStorage.setItem(GOV_DIR_KEY, document.getElementById('gov-dir').value.trim());
  renderGovernance();
}

// GUI-C (KJC-TSK-0773): actions call the same CLI commands through the board.
async function govPost(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: localStorage.getItem(GOV_DIR_KEY) || '', ...body }) });
  const data = await res.json().catch(() => ({ ok: false, error: `API error: ${res.status}` }));
  return data;
}

function govSay(text, warn) {
  const el = document.getElementById('gov-msg');
  if (el) { el.textContent = text; el.className = warn ? 'gov-note gov-note--warn' : 'gov-note'; }
}

// Spoken rule: propose shows the diff kj would write; apply asks first, then --yes.
async function govRule(apply) {
  const text = document.getElementById('gov-rule-text').value.trim();
  const out = document.getElementById('gov-rule-out');
  if (!text) return govSay('say the rule first', true);
  if (apply && !(await showConfirm(`Write this rule into .karajan/policy.yml?\n\n${text}\n\nThe diff shown below is what lands.`, { title: 'Apply rule', okLabel: 'Apply' }))) return;
  govRuleText = text;
  govRuleOut = apply ? 'applying…' : 'translating…';
  out.textContent = govRuleOut;
  govBusy = true;
  const r = await govPost('/api/governance/rule', { text, apply: apply === true }).finally(() => { govBusy = false; });
  govRuleOut = r.output || r.error || '';
  const pre = document.getElementById('gov-rule-out');
  if (pre) pre.textContent = govRuleOut;
  if (!r.ok) return govSay(r.error || 'rule refused', true);
  if (apply) { govRuleText = ''; renderGovernance(); }
}

async function govAnchor() {
  const r = await govPost('/api/governance/anchor', {});
  if (!r.ok) return govSay(r.error || 'anchor failed', true);
  renderGovernance();
}

async function govGrant() {
  const rule = document.getElementById('gov-grant-rule').value.trim();
  const until = document.getElementById('gov-grant-until').value;
  const reason = document.getElementById('gov-grant-reason').value.trim();
  if (!rule || !until || !reason) return govSay('rule, until and reason are required — an exception without who/why/until is a hole', true);
  const iso = new Date(`${until}T23:59:59Z`).toISOString();
  if (!(await showConfirm(`Grant a standing exception to ${rule} until ${iso}?\n\n${reason}\n\nIt is recorded with this clone's declared identity and expires on its own.`, { title: 'Grant exception', okLabel: 'Grant' }))) return;
  const r = await govPost('/api/governance/grant', { rule, until: iso, reason });
  if (!r.ok) return govSay(r.error || 'grant refused', true);
  renderGovernance();
}

const govDirForm = (dir) => `
  <div class="section-header"><span class="section-header__title">Governance</span>
    <span class="gov-dir"><input id="gov-dir" class="gov-dir__input" value="${esc(dir)}" placeholder="/absolute/project/dir" aria-label="Project directory">
    <button class="gov-btn" onclick="govSetDir()">Load</button></span></div>`;

const govIdentity = (id) => id && id.declared
  ? `<p class="gov-note">Identity declared for this clone: <strong>${esc(id.gh_user)}</strong> · ${esc(id.git_email)}</p>`
  : '<p class="gov-note gov-note--warn">Identity NOT declared for this clone — <code>kj identity set</code> (the Sentinel fails closed on gh and mutating git until then).</p>';

function govChain(report, anchor) {
  const d = report.decisions;
  const chain = report.chain.ok
    ? `<div class="stat-card__value stat-card__value--green">intact</div><div class="stat-card__label">chain · ${report.chain.length} decisions</div>`
    : `<div class="stat-card__value gov-red">BROKEN</div><div class="stat-card__label">at entry ${esc(String(report.chain.at))} — ${esc(report.chain.reason || '')}</div>`;
  const anchorBtn = report.chain.ok && (anchor.stale || !anchor.sealed) ? ' <button class="gov-btn" onclick="govAnchor()">Anchor now</button>' : '';
  const anch = !anchor.sealed
    ? `<div class="stat-card__value stat-card__value--yellow">none</div><div class="stat-card__label">anchor${anchorBtn}</div>`
    : `<div class="stat-card__value ${anchor.stale ? 'stat-card__value--yellow' : 'stat-card__value--green'}">${anchor.length}/${anchor.current}</div><div class="stat-card__label">anchored · ${anchor.stale ? 're-seal pending' : 'up to date'}${anchorBtn}</div>`;
  const cps = Object.entries(d.chokepoints || {}).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') || 'none';
  return `<div class="stats-grid">
    <div class="stat-card">${chain}</div><div class="stat-card">${anch}</div>
    <div class="stat-card"><div class="stat-card__value">${d.allow}</div><div class="stat-card__label">allow</div></div>
    <div class="stat-card"><div class="stat-card__value ${d.deny ? 'gov-red' : ''}">${d.deny}</div><div class="stat-card__label">deny · ${d.open} open</div></div>
    <div class="stat-card"><div class="stat-card__value stat-card__value--purple">${d.exempt}</div><div class="stat-card__label">exempt</div></div>
    <div class="stat-card"><div class="stat-card__value gov-small">${esc(cps)}</div><div class="stat-card__label">chokepoints</div></div></div>`;
}

function govRules(policy, report) {
  const rows = new Map();
  for (const r of policy.rules || []) rows.set(r.rule_id, { ...r, warns: 0, denies: 0, exempts: 0, open: 0 });
  for (const i of policy.invariants || []) rows.set(i.id, { rule_id: i.id, enforcement: i.enforcement, class: null, warns: 0, denies: 0, exempts: 0, open: 0 });
  for (const r of report.rules || []) rows.set(r.rule_id, { ...(rows.get(r.rule_id) || {}), ...r });
  const head = policy.declared
    ? (policy.error ? `<p class="gov-note gov-note--warn">policy.yml invalid: ${esc(policy.error)}</p>` : '')
    : '<p class="gov-note">No <code>.karajan/policy.yml</code> declared — only the consumer defaults apply. Speak a rule: <code>kj policy add "…"</code>.</p>';
  if (rows.size === 0) return `<div class="section-header"><span class="section-header__title">Rules</span></div>${head}<p class="gov-note">No rule has warned or denied yet.</p>${govRuleBox()}`;
  const body = [...rows.values()].sort((a, b) => (b.denies + b.warns) - (a.denies + a.warns)).map((r) => `
    <tr><td><code>${esc(r.rule_id)}</code></td><td><span class="gov-badge gov-badge--${esc(r.enforcement || 'warn')}">${esc(r.enforcement || 'warn')}</span>${r.class === 'security' ? ' <span class="gov-badge gov-badge--security" title="non-exemptable: no escape, no arbitration, no grant">security</span>' : ''}</td>
    <td>${r.warns}</td><td class="${r.denies ? 'gov-red' : ''}">${r.denies}</td><td>${r.exempts}</td><td class="${r.open ? 'gov-red' : ''}">${r.open}</td></tr>`).join('');
  return `<div class="section-header"><span class="section-header__title">Rules by friction</span><span class="section-header__count">${rows.size}</span></div>${head}
    <div class="gov-scroll"><table class="gov-table"><thead><tr><th>rule</th><th>enforcement</th><th>warn</th><th>deny</th><th>exempt</th><th>open</th></tr></thead><tbody>${body}</tbody></table></div>${govRuleBox()}`;
}

// Typed text and the last proposal survive the server-push re-renders.
let govRuleText = '';
let govRuleOut = '';
const govRuleBox = () => `<div class="gov-grant"><input id="gov-rule-text" class="gov-dir__input" value="${esc(govRuleText)}" oninput="govRuleText=this.value" placeholder="say a rule: the coder never writes .env files" aria-label="Spoken rule">
  <button class="gov-btn" onclick="govRule(false)">Propose</button><button class="gov-btn" onclick="govRule(true)">Apply</button></div><pre id="gov-rule-out" class="gov-pre" aria-live="polite">${esc(govRuleOut)}</pre>`;

function govGrants(g, policy) {
  const soon = new Set((g.soon || []).map((e) => e.ts || e.expiresAt + e.rule_id));
  const row = (e) => `<tr class="${soon.has(e.ts || e.expiresAt + e.rule_id) ? 'gov-row--soon' : ''}"><td><code>${esc(e.rule_id)}</code></td><td>${esc(e.expiresAt || '')}</td><td>${esc((e.who && e.who.git) || '?')}</td><td>${esc(e.justification || '')}</td></tr>`;
  const alive = (g.alive || []).length
    ? `<div class="gov-scroll"><table class="gov-table"><thead><tr><th>rule</th><th>until</th><th>granted by</th><th>why</th></tr></thead><tbody>${g.alive.map(row).join('')}</tbody></table></div>`
    : '<p class="gov-note">No standing exception alive.</p>';
  const renewals = (g.renewals || []).map((r) => `<li class="gov-red"><code>${esc(r.rule_id)}</code> granted ${r.count} times — a renewed exception is the policy asking to change</li>`).join('');
  // Only non-security rules can be granted: the inexemptable never gets a form.
  const grantable = (policy.rules || []).filter((r) => r.class !== 'security').map((r) => `<option value="${esc(r.rule_id)}">${esc(r.rule_id)}</option>`).join('');
  const form = grantable
    ? `<div class="gov-grant"><select id="gov-grant-rule" aria-label="Rule">${grantable}</select><input id="gov-grant-until" type="date" aria-label="Until"><input id="gov-grant-reason" class="gov-dir__input" placeholder="why, written now" aria-label="Reason"><button class="gov-btn" onclick="govGrant()">Grant until</button></div>`
    : '<p class="gov-note">Nothing grantable: no declared non-security rule.</p>';
  return `<div class="section-header"><span class="section-header__title">Standing exceptions</span><span class="section-header__count">${(g.alive || []).length} alive · ${(g.soon || []).length} expiring · ${(g.expired || []).length} expired · ${g.point || 0} one-off</span></div>${alive}${renewals ? `<ul class="gov-list">${renewals}</ul>` : ''}${form}<p id="gov-msg" class="gov-note"></p>`;
}

const govSignals = (signals) => `<div class="section-header"><span class="section-header__title">Signals</span></div>${(signals || []).length ? `<ul class="gov-list">${signals.map((s) => `<li>⚠ ${esc(s)}</li>`).join('')}</ul>` : '<p class="gov-note">None.</p>'}`;
