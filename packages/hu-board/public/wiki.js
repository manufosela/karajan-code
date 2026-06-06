// KJC-TSK-0508 — HU Board Wiki panel frontend. Calls POST /api/wiki/query
// (server-side spawns `qmd query --format json`) and renders the hits.
// A 503 with `installable:true` triggers an "Install QMD" CTA instead of
// a generic error so the user can act on the missing binary.
const TOKEN = new URLSearchParams(location.search).get("token") || localStorage.getItem("kj_board_token") || "";
const HEADERS = { "Content-Type": "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };
const ESC = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function renderInstallCTA(root) {
  root.innerHTML = `<div class="rag-card rag-card--error">
    <h3>QMD not installed</h3>
    <p>The semantic wiki engine is not available on this host. Install it once:</p>
    <pre class="wiki-code">npm install -g @tobilu/qmd</pre>
    <p class="rag-stat-sub">Then re-run <code>kj init</code> in this project to register the wiki collection.</p>
  </div>`;
}

function renderHits(root, results) {
  if (!Array.isArray(results) || results.length === 0) {
    root.innerHTML = '<p class="rag-empty">no hits — try a broader query or run <code>qmd update</code>.</p>';
    return;
  }
  root.innerHTML = results.map((r) => {
    const src = r.source || r.path || r.file || "(unknown source)";
    const snip = r.snippet || r.text || r.content || "";
    const score = typeof r.score === "number" ? r.score.toFixed(3) : "";
    return `<article class="wiki-hit">
      <header class="wiki-hit__head"><span class="wiki-hit__src">${ESC(src)}</span>${score ? `<span class="wiki-hit__score">${ESC(score)}</span>` : ""}</header>
      <pre class="wiki-hit__snip">${ESC(snip)}</pre>
    </article>`;
  }).join("");
}

async function runSearch(ev) {
  ev?.preventDefault();
  const root = document.getElementById("wiki-results");
  const query = document.getElementById("wiki-q").value.trim();
  if (!query) return;
  const collection = document.getElementById("wiki-collection").value.trim() || undefined;
  const fast = document.getElementById("wiki-fast").checked;
  root.innerHTML = '<div class="loading"><div class="loading__spinner"></div><p>Searching the wiki…</p></div>';
  try {
    const res = await fetch("/api/wiki/query", { method: "POST", headers: HEADERS, body: JSON.stringify({ query, collection, fast }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503 && data.installable) { renderInstallCTA(root); return; }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderHits(root, data.results);
  } catch (err) {
    root.innerHTML = `<div class="rag-card rag-card--error"><strong>Error:</strong> ${ESC(err.message || String(err))}</div>`;
  }
}

document.getElementById("wiki-form").addEventListener("submit", runSearch);
