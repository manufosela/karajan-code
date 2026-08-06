// @ts-check
/**
 * Capa Easy RAG — página del query playground (KJR-TSK-0150).
 *
 * Autocontenida por diseño: cero assets externos (ni CDN, ni fuentes, ni
 * frameworks) para funcionar en despliegues privados sin salida a
 * internet. Todo el renderizado de datos usa textContent — nunca
 * innerHTML con contenido del corpus (XSS). La autenticación es de la
 * capa de despliegue (IAM/invoker), como el resto de la API.
 */

export const PLAYGROUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>karajan-rag playground</title>
<style>
  :root { color-scheme: dark light;
    --bg:#0f1520; --card:#1a2332; --border:#2a3a4e; --text:#e2e8f0;
    --dim:#94a4ac; --gold:#e8b04b; --mono:ui-monospace,monospace; }
  @media (prefers-color-scheme: light) { :root {
    --bg:#f4f7f9; --card:#ffffff; --border:#d0dbe3; --text:#1a2a35;
    --dim:#4b555b; --gold:#b7832a; } }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--text); font:16px/1.6 system-ui,sans-serif;
    max-width:860px; margin:0 auto; padding:2rem 1rem; }
  h1 { font-size:1.3rem; margin-bottom:.2rem; }
  h1 .rag { color:var(--gold); }
  .sub { color:var(--dim); font-size:.85rem; margin-bottom:1.5rem; }
  form { display:flex; flex-wrap:wrap; gap:.6rem; margin-bottom:1.5rem; }
  input[type=text] { flex:1 1 100%; padding:.7rem .9rem; font-size:1rem;
    background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:8px; }
  select,input[type=number] { padding:.45rem .6rem; background:var(--card); color:var(--text);
    border:1px solid var(--border); border-radius:8px; font-family:var(--mono); font-size:.85rem; }
  button { padding:.5rem 1.1rem; border-radius:8px; border:1px solid var(--gold);
    background:transparent; color:var(--gold); font-weight:600; cursor:pointer; }
  button:hover { background:var(--gold); color:var(--bg); }
  .badges { display:flex; gap:.5rem; flex-wrap:wrap; margin-bottom:.8rem; }
  .badge { font-family:var(--mono); font-size:.72rem; border:1px solid var(--border);
    border-radius:999px; padding:.15rem .7rem; color:var(--dim); }
  .badge.gold { color:var(--gold); border-color:var(--gold); }
  .answer { background:var(--card); border:1px solid var(--gold); border-radius:10px;
    padding:1rem 1.2rem; margin-bottom:1.2rem; white-space:pre-wrap; }
  .hit { background:var(--card); border:1px solid var(--border); border-radius:10px;
    padding: .8rem 1rem; margin-bottom:.7rem; }
  .hit .src { font-family:var(--mono); font-size:.8rem; color:var(--gold); }
  .hit .score { color:var(--dim); font-size:.75rem; font-family:var(--mono); }
  .hit pre { white-space:pre-wrap; font-family:var(--mono); font-size:.82rem;
    color:var(--text); margin-top:.4rem; overflow-x:auto; }
  .error { border:1px solid #f87171; color:#f87171; border-radius:10px;
    padding: .8rem 1rem; margin-bottom:1rem; font-family:var(--mono); font-size:.85rem; }
  .status { color:var(--dim); font-size:.8rem; margin-bottom:1rem; }
</style>
</head>
<body>
<h1>karajan-<span class="rag">rag</span> playground</h1>
<p class="sub">Ask your corpus. Every answer shows which adapter the sensitivity policy allowed and at which level — guarantees are never hidden.</p>
<form id="f">
  <input type="text" id="q" placeholder="Ask something about this corpus…" aria-label="Question for the corpus" required>
  <select id="mode" aria-label="Context strategy (mode)">
    <option value="rag">mode: rag (top-k chunks)</option>
    <option value="cag">mode: cag (whole corpus)</option>
    <option value="hybrid">mode: hybrid (whole files)</option>
  </select>
  <input type="number" id="topk" min="1" max="100" value="5" aria-label="Number of hits (topK)">
  <button type="submit" data-action="query">Search</button>
  <button type="submit" data-action="answer">Answer</button>
</form>
<div id="out" aria-live="polite"></div>
<script>
(() => {
  const form = document.getElementById('f');
  const out = document.getElementById('out');

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // nunca innerHTML con datos
    return node;
  };

  const renderBadges = (data) => {
    const badges = el('div', 'badges');
    badges.appendChild(el('span', 'badge gold', 'adapter: ' + data.adapter));
    badges.appendChild(el('span', 'badge gold', 'level: ' + data.sensitivity));
    badges.appendChild(el('span', 'badge', 'mode: ' + data.mode));
    if (typeof data.filesCount === 'number') badges.appendChild(el('span', 'badge', 'files: ' + data.filesCount));
    if (typeof data.excludedCount === 'number' && data.excludedCount > 0) {
      badges.appendChild(el('span', 'badge', 'excluded by budget: ' + data.excludedCount));
    }
    return badges;
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // La acción se captura EN el submit (SubmitEvent.submitter): sin
    // estado mutable compartido entre clicks y awaits — imposible pintar
    // una respuesta por la rama equivocada.
    const action = (ev.submitter && ev.submitter.dataset.action) || 'query';
    out.replaceChildren(el('p', 'status', 'Working…'));
    const body = { question: document.getElementById('q').value };
    let path = '/query';
    if (action === 'answer') { path = '/answer'; body.mode = document.getElementById('mode').value; }
    const topK = parseInt(document.getElementById('topk').value, 10);
    if (Number.isInteger(topK)) body.topK = topK;
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      out.replaceChildren();
      if (!res.ok) { out.appendChild(el('div', 'error', 'HTTP ' + res.status + ' — ' + data.error)); return; }
      if (action === 'answer') {
        out.appendChild(renderBadges(data));
        out.appendChild(el('div', 'answer', data.answer));
        return;
      }
      if (!data.hits.length) { out.appendChild(el('p', 'status', 'No results.')); return; }
      for (const [i, hit] of data.hits.entries()) {
        const box = el('div', 'hit');
        const head = el('div');
        head.appendChild(el('span', 'src', (i + 1) + '. ' + hit.source + (hit.line ? ':' + hit.line : '')));
        head.appendChild(el('span', 'score', '  score ' + hit.score.toFixed(3)));
        box.appendChild(head);
        const pre = el('pre');
        pre.textContent = hit.content;
        box.appendChild(pre);
        out.appendChild(box);
      }
    } catch (err) {
      out.replaceChildren(el('div', 'error', String(err)));
    }
  });
})();
</script>
</body>
</html>
`;
