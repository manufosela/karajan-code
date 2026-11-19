// HU-4683 — accounts page. Renders what GET /api/accounts returns (never a key) and drives
// the POST routes; kj's own message, errors included, is shown on the page. Values from the
// API are data: the DOM is built with textContent only.
const TOKEN = new URLSearchParams(location.search).get("token") || localStorage.getItem("kj_board_token") || "";
const PACE_LABELS = { gap: "gap", max: "max", limitWait: "limit wait" };

/** The payload as plain rows: one per account and one per project order. */
function renderAccounts(payload) {
  const defaults = payload.default ?? {};
  const rows = (payload.accounts ?? []).map((a) => {
    const pace = Object.entries(a.pace ?? {}).map(([k, v]) => `${PACE_LABELS[k] ?? k} ${v}`).join(" · ");
    return { id: a.id, provider: a.provider, dir: a.dir, isDefault: defaults[a.provider] === a.id, pace: pace || "default pace" };
  });
  const orders = Object.entries(payload.projects ?? {}).flatMap(([project, byProvider]) => Object.entries(byProvider).map(([provider, ids]) => ({ project, provider, ids })));
  return { rows, orders };
}

function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function field(label, name, attrs = {}) {
  const wrap = el("label", `${label} `);
  wrap.append(el("input", undefined, { name, ...attrs }));
  return wrap;
}

function button(label, onClick) {
  const b = el("button", label, { type: "button", class: "control-btn" });
  b.addEventListener("click", onClick);
  return b;
}

let lastMessage = ""; // kj's answer to the last action, kept across the reload that follows it

async function call(route, body, status) {
  const headers = { "Content-Type": "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };
  try {
    const r = await fetch(`/api/accounts/${route}`, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await r.json();
    lastMessage = data.output || data.error || `HTTP ${r.status}`;
  } catch (e) { lastMessage = `Error: ${e.message}`; }
  status.textContent = lastMessage;
  await load();
}

/** Remove asks twice, inline: the first click turns into Confirm / Cancel. */
function removeButton(id, status) {
  const holder = el("span");
  const ask = () => {
    holder.replaceChildren(button(`Confirm remove ${id}`, () => call("remove", { id }, status)), button("Cancel", () => holder.replaceChildren(button("Remove", ask))));
  };
  holder.append(button("Remove", ask));
  return holder;
}

function paceForm(id, status) {
  const form = el("form");
  const inputs = Object.entries(PACE_LABELS).map(([key, label]) => field(label, key, { type: "number", min: "0", step: "any" }));
  form.append(...inputs, el("button", "Set pace", { type: "submit", class: "control-btn" }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = { id };
    for (const key of Object.keys(PACE_LABELS)) { const v = form.elements[key].value; if (v !== "") body[key] = Number(v); }
    call("pace", body, status);
  });
  return form;
}

function accountCard(row, status) {
  const card = el("article", undefined, { class: "rag-card" });
  card.append(el("h3", `${row.id}${row.isDefault ? " (default)" : ""}`), el("p", `${row.provider} · ${row.dir}`), el("p", row.pace));
  if (!row.isDefault) card.append(button("Make default", () => call("default", { id: row.id }, status)));
  card.append(removeButton(row.id, status), paceForm(row.id, status));
  return card;
}

function addForm(status) {
  const form = el("form");
  const provider = el("select", undefined, { name: "provider" });
  provider.append(el("option", "claude"), el("option", "codex"));
  const pick = el("label", "provider ");
  pick.append(provider);
  form.append(field("id", "id", { required: "" }), pick, field("absolute dir", "dir", { required: "" }), el("button", "Add account", { type: "submit", class: "control-btn" }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    call("add", { id: form.elements.id.value, provider: form.elements.provider.value, dir: form.elements.dir.value }, status);
  });
  return form;
}

function orderForm(rows, status) {
  const form = el("form");
  form.append(field("ids in order, space separated", "ids"), el("button", "Set order", { type: "submit", class: "control-btn" }));
  const ids = () => form.elements.ids.value.split(/[\s,]+/).filter(Boolean);
  form.addEventListener("submit", (e) => { e.preventDefault(); call("use", { ids: ids() }, status); });
  // kj needs ids even to clear: the typed ones, else every listed account.
  form.append(button("Clear order", () => call("use", { ids: ids().length ? ids() : rows.map((r) => r.id), clear: true }, status)));
  return form;
}

function draw(app, payload) {
  const { rows, orders } = renderAccounts(payload);
  const status = el("p", lastMessage, { role: "status" });
  const list = el("section", undefined, { class: "rag-grid" });
  list.append(...(rows.length ? rows.map((r) => accountCard(r, status)) : [el("p", "No accounts yet.", { class: "rag-empty" })]));
  const order = el("section");
  order.append(el("h2", "Project order"), ...orders.map((o) => el("p", `${o.project} · ${o.provider}: ${o.ids.join(" → ")}`)), orderForm(rows, status));
  app.replaceChildren(el("h2", "Accounts"), list, el("h2", "Add an account"), addForm(status), order, status);
}

async function load() {
  const app = document.getElementById("accounts-app");
  try {
    const r = await fetch("/api/accounts", { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    draw(app, await r.json());
  } catch (e) { app.replaceChildren(el("p", `Error: ${e.message}`, { class: "rag-card rag-card--error" })); }
}

if (document.getElementById("accounts-app")) load();
