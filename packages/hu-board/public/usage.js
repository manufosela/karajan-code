// HU-4593 (ADR 0064): the usage page. Reads /api/usage, shows totals and one row per period,
// project and account, and downloads /api/usage/export for one project and month.
const TOKEN = new URLSearchParams(location.search).get("token") || localStorage.getItem("kj_board_token") || "";
const HEADERS = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const ESC = (s) => String(s).replaceAll(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const SUMS = ["calls", "tokensIn", "tokensOut", "cachedTokens", "costUsd", "durationMs", "linesAdded", "linesRemoved"];

const num = (n) => (n === null ? "–" : n.toLocaleString("en"));
const lines = (added, removed) => (added === null && removed === null ? "–" : `+${num(added ?? 0)} / −${num(removed ?? 0)}`);
const usd = (n) => (n === null ? "–" : `$${n.toFixed(2)}`);
const minutes = (ms) => (ms === null ? "–" : `${(ms / 60000).toFixed(1)} min`);
const folder = (project) => project.split(/[\\/]/).findLast(Boolean) ?? project;

/** The column totals of every row; a figure no row reported stays null. */
function totals(rows) {
  return Object.fromEntries(SUMS.map((s) => [s, rows.reduce((t, r) => (r[s] === null ? t : (t ?? 0) + r[s]), null)]));
}

function card(title, big, sub) {
  return `<div class="rag-card"><h3>${ESC(title)}</h3><p class="rag-stat-big">${ESC(big)}</p><p class="rag-stat-sub">${ESC(sub)}</p></div>`;
}

function row(r) {
  return `<tr><td>${ESC(r.period)}</td><td title="${ESC(r.project)}">${ESC(folder(r.project))}</td><td>${ESC(r.account ?? "default login")}</td>
    <td>${num(r.calls)}</td><td>${num(r.tokensIn)}</td><td>${num(r.tokensOut)}</td><td>${num(r.cachedTokens)}</td>
    <td>${usd(r.costUsd)}</td><td>${minutes(r.durationMs)}</td><td>${lines(r.linesAdded, r.linesRemoved)}</td></tr>`;
}

function render(root, data) {
  if (data.rows.length === 0) {
    root.innerHTML = '<div class="rag-card"><p class="rag-empty">No agent calls recorded in these months.</p></div>';
    return;
  }
  const t = totals(data.rows);
  root.innerHTML = `<section class="rag-grid">
    ${card("Calls", num(t.calls), `${minutes(t.durationMs)} of agent time`)}
    ${card("Estimated cost", usd(t.costUsd), "at API prices; a subscription is billed by its plan")}
    ${card("Tokens", num(t.tokensIn === null && t.tokensOut === null ? null : (t.tokensIn ?? 0) + (t.tokensOut ?? 0)), `${num(t.cachedTokens)} cached`)}
    ${card("Lines", lines(t.linesAdded, t.linesRemoved), "written by kj code's coder")}
    <div class="rag-card rag-card--wide"><table class="usage-table">
      <thead><tr><th>Period</th><th>Project</th><th>Account</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Cached</th><th>Cost (est.)</th><th>Time</th><th>Lines</th></tr></thead>
      <tbody>${data.rows.map(row).join("")}</tbody>
    </table></div>
  </section>`;
}

function fillProjects(projects) {
  const select = $("usage-project");
  const chosen = select.value;
  select.replaceChildren(new Option("Every project", ""), ...projects.map((p) => new Option(folder(p), p)));
  select.value = projects.includes(chosen) ? chosen : "";
  $("usage-export").disabled = !select.value;
}

async function load() {
  const app = $("usage-app");
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading…</p></div>';
  const query = new URLSearchParams({ period: $("usage-period").value, from: $("usage-from").value, to: $("usage-to").value });
  if ($("usage-project").value) query.set("project", $("usage-project").value);
  try {
    const r = await fetch(`/api/usage?${query}`, { headers: HEADERS });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    fillProjects(data.projects);
    render(app, data);
  } catch (e) {
    app.innerHTML = `<div class="rag-card rag-card--error"><strong>Error:</strong> ${ESC(e.message)}</div>`;
  }
}

async function exportCsv() {
  const query = new URLSearchParams({ project: $("usage-project").value, month: $("usage-to").value });
  const r = await fetch(`/api/usage/export?${query}`, { headers: HEADERS });
  if (!r.ok) {
    $("usage-app").insertAdjacentHTML("afterbegin", `<div class="rag-card rag-card--error"><strong>Export failed:</strong> HTTP ${r.status}</div>`);
    return;
  }
  const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "usage.csv";
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await r.blob()), download: name });
  link.click();
  URL.revokeObjectURL(link.href);
}

const thisMonth = new Date().toISOString().slice(0, 7);
$("usage-from").value = thisMonth;
$("usage-to").value = thisMonth;
$("usage-filters").addEventListener("change", load);
$("usage-refresh").addEventListener("click", load);
$("usage-export").addEventListener("click", exportCsv);
document.addEventListener("DOMContentLoaded", load);
