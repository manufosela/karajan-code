/**
 * Pipeline observability client (TSK-0325).
 *
 * - Polls /api/pipeline/sessions for the session list (on refresh).
 * - Polls /api/pipeline/sessions/:id every 2 s for the selected session.
 * - Renders role cards, Solomon arbitrations, iteration log, summary.
 *
 * Zero dependencies, native fetch + DOM. Runs as ES module.
 */

const POLL_INTERVAL_MS = 2000;

const els = {
  sessionSelect: document.getElementById("sessionSelect"),
  refreshBtn: document.getElementById("refreshBtn"),
  roleGrid: document.getElementById("roleGrid"),
  solomonList: document.getElementById("solomonList"),
  iterationList: document.getElementById("iterationList"),
  summaryBlock: document.getElementById("summaryBlock"),
  lastRefresh: document.getElementById("lastRefresh"),
};

// Fixed set of pipeline roles we always render, even if the journal has not
// mentioned them yet. Mirrors src/orchestrator/stages/ + src/roles/.
const KNOWN_ROLES = [
  "triage",
  "discover",
  "domain-curator",
  "researcher",
  "architect",
  "planner",
  "coder",
  "refactorer",
  "sonar",
  "reviewer",
  "tester",
  "security",
  "impeccable",
  "audit",
];

let pollTimer = null;
let currentSessionId = null;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

async function api(path) {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/**
 * Walk the iteration list and derive {status, lastIteration, retries} per
 * role. A role is "done" if it appears in any iteration; "running" if it
 * appears in the latest iteration and has no "error" marker; "error" if the
 * body of its latest stage contains /error|failed/i.
 */
function deriveRoleStatus(iterations) {
  const summary = new Map();
  iterations.forEach((it) => {
    it.stages.forEach((stage) => {
      const name = String(stage.name || "").toLowerCase();
      const prev = summary.get(name) || { count: 0, lastIteration: 0, lastBody: "" };
      prev.count += 1;
      prev.lastIteration = Math.max(prev.lastIteration, it.number);
      prev.lastBody = stage.body;
      summary.set(name, prev);
    });
  });
  return summary;
}

function renderRoleGrid(iterations) {
  const status = deriveRoleStatus(iterations);
  const latest = iterations.reduce((m, it) => Math.max(m, it.number), 0);
  const rendered = new Set();
  const cards = [];
  const makeCard = (roleName) => {
    const info = status.get(roleName.toLowerCase());
    let state = "idle";
    let meta = "not run yet";
    if (info) {
      const errored = /error|failed|✗|blocked/i.test(info.lastBody);
      const isLatest = info.lastIteration === latest && latest > 0;
      state = errored ? "error" : (isLatest ? "running" : "done");
      meta = `iter #${info.lastIteration} · ${info.count} run${info.count > 1 ? "s" : ""}`;
    }
    rendered.add(roleName.toLowerCase());
    return `<article class="role-card" data-status="${state}"><span class="name">${escapeHtml(roleName)}</span><span class="meta">${escapeHtml(meta)}</span></article>`;
  };
  for (const r of KNOWN_ROLES) cards.push(makeCard(r));
  // Render any journal-observed role we did not know about (future roles).
  for (const [name] of status) {
    if (!rendered.has(name)) cards.push(makeCard(name));
  }
  els.roleGrid.innerHTML = cards.join("");
}

function renderSolomon(decisions) {
  const solomon = decisions.filter((d) => /solomon/i.test(d.heading));
  if (solomon.length === 0) {
    els.solomonList.innerHTML = `<li><em>No Solomon arbitrations in this session yet.</em></li>`;
    return;
  }
  els.solomonList.innerHTML = solomon
    .map((s) => `<li><strong>${escapeHtml(s.heading)}</strong><pre>${escapeHtml(s.body)}</pre></li>`)
    .join("");
}

function renderIterations(iterations) {
  if (iterations.length === 0) {
    els.iterationList.innerHTML = `<li><em>Session has not produced iterations yet.</em></li>`;
    return;
  }
  els.iterationList.innerHTML = iterations
    .slice()
    .reverse() // latest on top
    .map((it) => {
      const stages = it.stages
        .map((st) => `<div><strong>${escapeHtml(st.name)}</strong><pre>${escapeHtml(st.body)}</pre></div>`)
        .join("");
      const dur = it.duration ? ` — ${escapeHtml(it.duration)}` : "";
      return `<li><strong>${escapeHtml(it.title)}${dur}</strong>${stages}</li>`;
    })
    .join("");
}

function renderSummary(summary) {
  if (!summary) { els.summaryBlock.textContent = ""; return; }
  const body = [summary.preamble, ...summary.sections.map((s) => `## ${s.heading}\n${s.body}`)]
    .filter(Boolean).join("\n\n");
  els.summaryBlock.textContent = body.trim() || "(empty summary.md)";
}

async function refreshOnce() {
  if (!currentSessionId) return;
  try {
    const journal = await api(`/api/pipeline/sessions/${encodeURIComponent(currentSessionId)}`);
    renderRoleGrid(journal.iterations);
    renderSolomon(journal.decisions);
    renderIterations(journal.iterations);
    renderSummary(journal.summary);
    els.lastRefresh.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    els.lastRefresh.textContent = `Error: ${err.message}`;
  }
}

async function loadSessions() {
  const { sessions } = await api("/api/pipeline/sessions");
  els.sessionSelect.innerHTML = sessions
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.id)} (${new Date(s.mtime).toLocaleString()})</option>`)
    .join("");
  if (sessions.length > 0 && !currentSessionId) {
    currentSessionId = sessions[0].id;
  }
  if (currentSessionId) {
    els.sessionSelect.value = currentSessionId;
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshOnce, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

els.sessionSelect.addEventListener("change", (e) => {
  currentSessionId = e.target.value || null;
  refreshOnce();
});

els.refreshBtn.addEventListener("click", async () => {
  await loadSessions();
  await refreshOnce();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else startPolling();
});

// Boot
(async () => {
  await loadSessions();
  await refreshOnce();
  startPolling();
})();
