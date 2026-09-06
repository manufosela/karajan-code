// KJC-TSK-0816 (MGL-E, ADR 0008) — el panel «Conversación»: la terminal
// REAL del agente dentro del board. Script clásico, como el resto.
//
// Globals: Terminal (de /vendor/xterm), esc(), maggleText(), showError().
// El token del pty llega de /api/terminal/start (tras el auth del board)
// y viaja al WS como SUBPROTOCOLO, nunca en la URL.

let conversationState = { ws: null, term: null, panel: null, termId: null, token: null, opening: false };

async function openConversationPanel() {
  if (conversationState.panel && conversationState.dead) {
    // La conexión murió (agente terminado o red): reabrir = sesión fresca.
    conversationState.panel.remove();
    conversationState = { ws: null, term: null, panel: null, termId: null, token: null, opening: false };
  }
  if (conversationState.panel) {
    conversationState.panel.style.display = 'flex';
    conversationState.term?.focus();
    return;
  }
  // Un doble clic (o ?window=1 + clic) no debe abrir dos sesiones.
  if (conversationState.opening) return;
  conversationState.opening = true;
  let started;
  try {
    const res = await fetch('/api/terminal/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Sin agente en el body: decide el servidor (kj go --window fija el
      // elegido por env; sin él, claude).
      body: JSON.stringify({}),
    });
    started = await res.json();
    if (!res.ok) throw new Error(started.error || `HTTP ${res.status}`);
  } catch (err) {
    conversationState.opening = false;
    await showError(err.message, { title: 'La conversación no pudo arrancar' });
    return;
  }
  conversationState.opening = false;
  conversationState.termId = started.termId;
  conversationState.token = started.token;

  const panel = document.createElement('section');
  panel.id = 'kj-conversation-panel';
  panel.style.cssText = [
    'position:fixed', 'top:0', 'right:0', 'bottom:0',
    'width:min(720px, 55vw)', 'display:flex', 'flex-direction:column',
    'background:#0b0b0c', 'border-left:1px solid var(--border)',
    'box-shadow:-12px 0 40px rgba(0,0,0,0.45)', 'z-index:9998',
  ].join(';');
  panel.innerHTML = `
    <header style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;
                   background:var(--bg-primary);border-bottom:1px solid var(--border);flex-shrink:0">
      <strong style="color:var(--text)">${esc(maggleText('conversation.title', 'Conversación con tu agente'))}</strong>
      <div style="display:flex;gap:6px">
        <button id="conv-hide" type="button" class="control-btn" title="${esc(maggleText('conversation.hide', 'Ocultar — la conversación sigue viva'))}"
                style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-primary);color:var(--text);border-radius:var(--radius-sm);cursor:pointer">_</button>
        <button id="conv-end" type="button" class="control-btn" title="${esc(maggleText('conversation.end', 'Terminar la sesión del agente'))}"
                style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-primary);color:#f87171;border-radius:var(--radius-sm);cursor:pointer">✕</button>
      </div>
    </header>
    <div id="conv-term" style="flex:1 1 auto;min-height:0;padding:6px"></div>
  `;
  document.body.appendChild(panel);
  conversationState.panel = panel;

  const term = new Terminal({
    convertEol: false,
    cursorBlink: true,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 13,
    theme: { background: '#0b0b0c' },
  });
  term.open(panel.querySelector('#conv-term'));
  conversationState.term = term;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(
    `${proto}://${location.host}/api/terminal/ws?termId=${encodeURIComponent(started.termId)}`,
    ['kj-terminal', started.token],
  );
  conversationState.ws = ws;
  ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '');
  ws.onclose = () => {
    conversationState.dead = true;
    term.write('\r\n[conexión cerrada — vuelve a abrir el panel para reconectar]\r\n');
  };
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  const sendResize = () => {
    const el = panel.querySelector('#conv-term');
    const cols = Math.max(40, Math.floor(el.clientWidth / 8));
    const rows = Math.max(10, Math.floor(el.clientHeight / 18));
    term.resize(cols, rows);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\u0000${JSON.stringify({ type: 'resize', cols, rows })}`);
    }
  };
  ws.onopen = () => { sendResize(); term.focus(); };
  window.addEventListener('resize', sendResize);

  panel.querySelector('#conv-hide').addEventListener('click', () => {
    panel.style.display = 'none';
  });
  panel.querySelector('#conv-end').addEventListener('click', async () => {
    try {
      await fetch('/api/terminal/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termId: conversationState.termId, token: conversationState.token }),
      });
    } finally {
      ws.close();
      panel.remove();
      conversationState = { ws: null, term: null, panel: null, termId: null, token: null, opening: false };
    }
  });
}

// kj go --window abre el board con ?window=1: la conversación arranca sola.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (new URLSearchParams(location.search).get('window') === '1') openConversationPanel();
    } catch {
      // Sin soporte de URLSearchParams no hay auto-apertura; el botón queda.
    }
  });
}
