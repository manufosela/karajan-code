// KJC-TSK-0445 — Retrieval dashboard frontend. Fetches /api/rag/stats and
// renders chunk counts per project/kind, embedder, DB size and last-index.
const TOKEN = new URLSearchParams(location.search).get("token") || localStorage.getItem("kj_board_token") || "";
const HEADERS = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const ESC = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function bytes(n) { for (const u of ["B", "KB", "MB", "GB"]) { if (n < 1024) return `${u === "B" ? n : n.toFixed(1)} ${u}`; n /= 1024; } return `${n.toFixed(2)} TB`; }

function bars(rows, lab, val, max) {
  if (!rows.length) return '<p class="rag-empty">no data</p>';
  return rows.map((r) => `<div class="rag-bar"><span class="rag-bar__label">${ESC(lab(r))}</span><span class="rag-bar__fill" style="width:${Math.round((val(r) / max) * 100)}%"></span><span class="rag-bar__value">${val(r).toLocaleString()}</span></div>`).join("");
}

function embedderCard(e) {
  return e ? `<div class="rag-card"><h3>Embedder</h3><p class="rag-stat-big">${ESC(e.provider)}</p><p class="rag-stat-sub">${ESC(e.model || "default model")} · dim ${e.dim ?? "?"}</p></div>` : "";
}

function render(root, data) {
  if (!data.initialized) { root.innerHTML = `<section class="rag-grid"><div class="rag-card"><h3>RAG DB</h3><p class="rag-empty">${ESC(data.message || "not initialized")}</p></div>${embedderCard(data.embedder)}</section>`; return; }
  const lastIdx = data.last_indexed ? new Date(data.last_indexed).toLocaleString() : "never";
  const mk = Math.max(1, ...data.by_kind.map((r) => r.n));
  const mp = Math.max(1, ...data.by_project.map((r) => r.n));
  root.innerHTML = `<section class="rag-grid">
    <div class="rag-card"><h3>Totals</h3><p class="rag-stat-big">${data.total_chunks.toLocaleString()}</p><p class="rag-stat-sub">chunks · ${bytes(data.db_size_bytes)} · last indexed ${ESC(lastIdx)}</p></div>
    ${embedderCard(data.embedder)}
    <div class="rag-card rag-card--wide"><h3>By kind</h3>${bars(data.by_kind, (r) => r.kind, (r) => r.n, mk)}</div>
    <div class="rag-card rag-card--wide"><h3>By project (top 20)</h3>${bars(data.by_project, (r) => r.project, (r) => r.n, mp)}</div>
  </section>`;
}

async function load() {
  const app = document.getElementById("rag-app");
  app.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Loading…</p></div>';
  try { const r = await fetch("/api/rag/stats", { headers: HEADERS }); if (!r.ok) throw new Error(`HTTP ${r.status}`); render(app, await r.json()); }
  catch (e) { app.innerHTML = `<div class="rag-card rag-card--error"><strong>Error:</strong> ${ESC(e.message)}</div>`; }
}

document.getElementById("rag-refresh").addEventListener("click", load);
load();
