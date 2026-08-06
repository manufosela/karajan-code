// KJC-TSK-0501 — Pure formatters extracted from app.js (step 1/8).
// Loaded as a classic script before app.js — all declarations hoist to
// global scope so app.js consumes them transparently. No ES module syntax
// here on purpose: app.js still has 16+ inline `onclick="fn(...)"`
// handlers that rely on global functions. Conversion to `type="module"`
// will land in a later PR of this split alongside event delegation.
//
// Functions here are side-effect-free (no DOM mutation beyond
// `document.createElement('span')` for HTML-escape, no fetch, no
// module-level mutable state). Unit-tested directly via
// packages/hu-board/tests/format.test.js for the three shared helpers.

function formatHHMM(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function shortTask(text, max = 60) {
  if (!text) return "";
  const collapsed = String(text).replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + "…";
}

function formatSessionLabel(session) {
  if (!session || !session.id) {
    return { title: "(no session)", subtitle: "", idChip: "" };
  }
  const projectName = (session.project_name || "").trim();
  const time = formatHHMM(session.created_at);
  const projectPart = projectName
    ? projectName.length > 40
      ? projectName.slice(0, 39) + "…"
      : projectName
    : session.id;
  const title = time !== "—" ? `${projectPart} · ${time}` : projectPart;
  return {
    title,
    subtitle: shortTask(session.task, 60),
    idChip: session.id,
  };
}

function formatCost(costUsd) {
  if (costUsd === null || costUsd === undefined) return null;
  const n = Number(costUsd);
  if (!Number.isFinite(n)) return null;
  return {
    label: `$${n.toFixed(2)}`,
    tooltip: `Estimated cost: $${n.toFixed(4)}`,
  };
}

// Φ0-G (KJC-TSK-0525): mirror of formatCacheRatio in src/format.js.
// Kept duplicated because this file is a classic script loaded into
// the browser, while src/format.js uses ES modules and is consumed by
// Node tests. See KJC-TSK-0501 header notes above.
function formatCacheRatio(cachedTokens, tokensIn) {
  if (cachedTokens === null || cachedTokens === undefined) return null;
  if (tokensIn === null || tokensIn === undefined) return null;
  const c = Number(cachedTokens);
  const t = Number(tokensIn);
  if (!Number.isFinite(c) || !Number.isFinite(t)) return null;
  if (t <= 0 || c < 0) return null;
  const pct = Math.round((c / t) * 1000) / 10;
  const num = c.toLocaleString("en-US");
  const den = t.toLocaleString("en-US");
  return {
    label: `🎯 ${pct}%`,
    tooltip: `Cache hits: ${num} / ${den} input tokens (${pct}%)`,
  };
}

function formatProjectCostSummary(cost) {
  if (!cost || typeof cost !== "object") return null;
  const total = Number(cost.totalUsd);
  if (!Number.isFinite(total)) return null;
  const byPlan = Array.isArray(cost.byPlan) ? cost.byPlan : [];
  if (total === 0 && byPlan.length === 0) return null;

  const lines = [`Total: $${total.toFixed(4)}`];
  // Φ0-G (KJC-TSK-0525): aggregate cache hits line + per-plan suffix.
  const projCache = formatCacheRatio(cost.cachedTokens, cost.tokensIn);
  if (projCache) lines.push(`Cache: ${projCache.tooltip.split(": ")[1]}`);
  if (byPlan.length > 0) {
    lines.push("By plan:");
    for (const p of byPlan) {
      const planTotal = Number(p?.totalUsd);
      if (!Number.isFinite(planTotal)) continue;
      const huCount = Number.isFinite(p?.huCount) ? p.huCount : 0;
      const planLabel = p?.planId || "unassigned";
      const cachePct = p?.cachedRatioPct;
      const cacheSuffix = (cachePct !== null && cachePct !== undefined && Number.isFinite(Number(cachePct)))
        ? ` 🎯 ${cachePct}%`
        : "";
      lines.push(`  ${planLabel}: $${planTotal.toFixed(2)} (${huCount} HU${huCount === 1 ? "" : "s"})${cacheSuffix}`);
    }
  }
  const unk = cost.unknownModelTokens;
  if (unk && Number.isFinite(unk.tokensIn) && Number.isFinite(unk.tokensOut)) {
    const unkTotal = unk.tokensIn + unk.tokensOut;
    if (unkTotal > 0) {
      lines.push(`(${unkTotal} tokens with unknown pricing not included)`);
    }
  }
  return {
    label: `Total: $${total.toFixed(2)}`,
    tooltip: lines.join("\n"),
  };
}

function humaniseProjectName(id) {
  if (!id || typeof id !== 'string') return id || '';
  const tail = id.split(/[/_]/).filter(Boolean).pop() || id;
  const words = tail
    .split(/[\s-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0);
  if (words.length === 0) return id;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function deriveInitialsFromName(name) {
  const words = String(name || '')
    .split(/[\s\-_/]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 1);
  return words.map((w) => w[0].toLowerCase()).join('').slice(0, 5) || 'kj';
}

function shortStoryId(story, initials) {
  const id = story?.id || '';
  const m = /_(\d+)(?!.*\d)/.exec(id);
  const num = m ? m[1] : '?';
  return `${initials || 'kj'}-${num}`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms) {
  if (!ms) return '--';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec.toString().padStart(2, '0')}s`;
}

function scoreClass(score, max = 60) {
  if (score === null || score === undefined) return '';
  const pct = score / max;
  if (pct >= 0.7) return 'story-card__score--good';
  if (pct >= 0.4) return 'story-card__score--ok';
  return 'story-card__score--bad';
}

function qualityBar(score, max = 60) {
  if (score === null || score === undefined) return '';
  const filled = Math.round((score / max) * 10);
  let html = '<span class="quality-bar">';
  for (let i = 0; i < 10; i++) {
    html += `<span class="quality-bar__segment${i < filled ? ' quality-bar__segment--filled' : ''}"></span>`;
  }
  html += '</span>';
  return html;
}

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

const EPHEMERAL_HEURISTIC_RE = /^(auto-)?(tmp_|test_|demo_|kj-test-)/i;

function isTestIcon(p) {
  if (p.is_test === 1) return '🧪';
  if (p.is_test === 0) return '📌';
  return EPHEMERAL_HEURISTIC_RE.test(p.id || '') ? '🧪?' : '·';
}

function isTestTitle(p) {
  if (p.is_test === 1) return 'Marked as test — auto-cleans 24h after last activity. Click to pin.';
  if (p.is_test === 0) return 'Pinned — never auto-cleans. Click to clear.';
  if (EPHEMERAL_HEURISTIC_RE.test(p.id || '')) {
    return 'Looks ephemeral by id heuristic — will auto-clean after 24h. Click to pin.';
  }
  return 'Real project — never auto-cleans. Click to mark as test.';
}

function truncate(text, max = 100) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function ansi256ToCss(n) {
  if (n < 0 || n > 255) return 'inherit';
  const std = [
    '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
  ];
  if (n < 16) return std[n];
  if (n < 232) {
    const idx = n - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor(idx / 6) % 6;
    const b = idx % 6;
    const v = (c) => (c === 0 ? 0 : 55 + c * 40);
    return `rgb(${v(r)},${v(g)},${v(b)})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

const ANSI_SGR = {
  1: 'font-weight:bold',
  2: 'opacity:0.65',
  3: 'font-style:italic',
  4: 'text-decoration:underline',
  30: 'color:#1f2937', 31: 'color:#f87171', 32: 'color:#4ade80',
  33: 'color:#fbbf24', 34: 'color:#60a5fa', 35: 'color:#c084fc',
  36: 'color:#22d3ee', 37: 'color:#e5e7eb',
  90: 'color:#9ca3af', 91: 'color:#fca5a5', 92: 'color:#86efac',
  93: 'color:#fde68a', 94: 'color:#93c5fd', 95: 'color:#d8b4fe',
  96: 'color:#67e8f9', 97: 'color:#f3f4f6',
};

const ESC_CHARS = new Set([0x1B, 0x241B]);
const HTML_ESC = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ansiToHtml(text) {
  const src = String(text);
  const N = src.length;
  let out = '';
  let openSpans = 0;
  let i = 0;

  while (i < N) {
    const code = src.charCodeAt(i);
    if (!ESC_CHARS.has(code)) {
      let j = i + 1;
      while (j < N && !ESC_CHARS.has(src.charCodeAt(j))) j += 1;
      out += HTML_ESC(src.slice(i, j));
      i = j;
      continue;
    }
    if (src[i + 1] !== '[') { i += 1; continue; }
    const endM = src.indexOf('m', i + 2);
    if (endM === -1) { i += 1; continue; }
    const params = src.slice(i + 2, endM).split(';').map((n) => Number(n) || 0);
    let k = 0;
    while (k < params.length) {
      const c = params[k];
      if (c === 0) {
        while (openSpans > 0) { out += '</span>'; openSpans -= 1; }
        k += 1;
      } else if ((c === 38 || c === 48) && params[k + 1] === 2 && params.length >= k + 5) {
        const r = params[k + 2], g = params[k + 3], b = params[k + 4];
        const prop = c === 38 ? 'color' : 'background-color';
        out += `<span style="${prop}:rgb(${r},${g},${b})">`;
        openSpans += 1;
        k += 5;
      } else if ((c === 38 || c === 48) && params[k + 1] === 5 && params.length >= k + 3) {
        const prop = c === 38 ? 'color' : 'background-color';
        out += `<span style="${prop}:${ansi256ToCss(params[k + 2])}">`;
        openSpans += 1;
        k += 3;
      } else if (ANSI_SGR[c]) {
        out += `<span style="${ANSI_SGR[c]}">`;
        openSpans += 1;
        k += 1;
      } else {
        k += 1;
      }
    }
    i = endM + 1;
  }
  while (openSpans > 0) { out += '</span>'; openSpans -= 1; }
  return out;
}

function cssEscape(str) {
  return (window.CSS && CSS.escape) ? CSS.escape(str) : String(str).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
