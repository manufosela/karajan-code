// C1-UI (KJC-TSK-0785, ADR 0007) — the console page: no framework, no build.
// Google Identity Services hands over an ID token; every call carries it and
// the SERVER decides (domain, role). The UI only shows what the API answered.
const TOKEN_KEY = "karajan-console.idToken";
const state = { token: sessionStorage.getItem(TOKEN_KEY), status: null, me: null };
const $ = (selector) => document.querySelector(selector);

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.includes("-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of children) node.append(child);
  return node;
};
const show = (view) => {
  for (const section of document.querySelectorAll("[data-view]"))
    section.hidden = section.dataset.view !== view;
};
const notice = (text, kind = "info") => {
  const n = $("#notice");
  n.textContent = text;
  n.className = `notice ${kind}`;
  n.hidden = !text;
};

async function api(path, init = {}) {
  const headers = {
    ...(init.headers || {}),
    ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
    ...(init.body ? { "content-type": "application/json" } : {}),
  };
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = await res
    .json()
    .catch(() => ({ ok: false, error: `${res.status} ${res.statusText}` }));
  if (!res.ok)
    throw Object.assign(new Error(body.error || res.statusText), {
      status: res.status,
      code: body.code,
    });
  return body;
}

function renderHome(identity, cfg) {
  $("#who-email").textContent = identity.email;
  $("#who-role").textContent = identity.role;
  $("#who").hidden = false;
  const can = {
    reader: "see corpus health and history",
    operator: "also run operations",
    admin: "also manage access and credentials",
  }[identity.role];
  const facts = [
    ["Instance", cfg.instance.name],
    ["Domains", cfg.instance.allowedDomains.join(", ")],
    ["Your role", `${identity.role} — ${can}`],
    [
      "Corpora",
      cfg.corpora
        .map((c) => `${c.name}${c.available ? "" : " (not available in this build)"}`)
        .join(", ") || "none",
    ],
    [
      "Operations",
      cfg.operations.map((o) => `${o.id} (${o.roles.join("/")})`).join(", ") || "none",
    ],
    ["Audit", cfg.audit.sink],
  ];
  $("#facts").replaceChildren(...facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
}

// Corpora health for everyone; access lists for admins, with an inline confirmation before a revoke
// (no native dialogs) and the server's answer shown as it came.
async function renderCorpora(cfg) {
  const { corpora } = await api("/corpora");
  $("#corpora").replaceChildren(
    ...corpora.map((c) =>
      el(
        "li",
        { className: c.ok ? "ok" : "bad" },
        el("strong", {}, c.name),
        el(
          "span",
          { className: "meta" },
          c.ok
            ? `${c.files ?? "?"} files · ${c.chunks ?? "?"} chunks · ${c.fingerprint ?? ""}`
            : `unavailable — ${c.error}`
        )
      )
    )
  );
  if (state.me.role !== "admin") return;
  $("#access").hidden = false;
  const domain = cfg.instance.allowedDomains[0];
  $("#access-lists").replaceChildren(
    ...(await Promise.all(cfg.corpora.map((corpus) => renderAccess(corpus, domain))))
  );
}

async function renderAccess(corpus, domain) {
  const box = el("div", { className: "access" }, el("h3", {}, corpus.name));
  const refresh = async () => {
    try {
      const { members } = await api(`/corpora/${encodeURIComponent(corpus.id)}/access`);
      list.replaceChildren(...members.map((m) => memberRow(corpus, m, refresh)));
      if (!members.length) list.append(el("li", { className: "hint" }, "nobody yet"));
    } catch (err) {
      list.replaceChildren(el("li", { className: "bad" }, `cannot read access: ${err.message}`));
    }
  };
  const list = el("ul", { className: "members" });
  const input = el("input", {
    type: "email",
    placeholder: `someone@${domain}`,
    required: true,
    "aria-label": `email to grant on ${corpus.name}`,
  });
  const form = el(
    "form",
    {},
    input,
    el("button", { type: "submit", className: "ghost" }, "Grant access")
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/corpora/${encodeURIComponent(corpus.id)}/access`, {
        method: "POST",
        body: JSON.stringify({ email: input.value }),
      });
      input.value = "";
      notice(`Access granted on ${corpus.name}.`);
      await refresh();
    } catch (err) {
      notice(`Grant refused: ${err.message}`, "error");
    }
  });
  box.append(list, form);
  await refresh();
  return box;
}

function memberRow(corpus, email, refresh) {
  const revoke = el("button", { type: "button", className: "ghost" }, "Remove");
  const confirm = el(
    "button",
    { type: "button", className: "ghost danger", hidden: true },
    `Confirm: remove ${email}`
  );
  revoke.addEventListener("click", () => {
    confirm.hidden = false;
    revoke.hidden = true;
  });
  confirm.addEventListener("click", async () => {
    try {
      await api(`/corpora/${encodeURIComponent(corpus.id)}/access/${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      notice(`Access removed on ${corpus.name}.`);
      await refresh();
    } catch (err) {
      notice(`Remove refused: ${err.message}`, "error");
    }
  });
  return el("li", {}, el("span", {}, email), revoke, confirm);
}

// Operations: a Run button only when the person's role is one the operation names; the run's
// status is polled until it settles. The audit trail (admins): the last entries and the chain verdict.
const RANK = { reader: 1, operator: 2, admin: 3 };
function renderOperations(cfg) {
  if (!cfg.operations.length) return;
  $("#operations-box").hidden = false;
  $("#operations").replaceChildren(...cfg.operations.map((op) => operationRow(op)));
}

function operationRow(op) {
  const status = el(
    "span",
    { className: "meta" },
    op.available ? "" : "not available in this build"
  );
  const allowed = op.available && op.roles.some((r) => RANK[state.me.role] >= RANK[r]);
  const run = el("button", { type: "button", className: "ghost", disabled: !allowed }, "Run");
  run.addEventListener("click", async () => {
    run.disabled = true;
    status.textContent = "starting…";
    try {
      const out = await api(`/operations/${encodeURIComponent(op.id)}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ inputs: {} }),
      });
      await followRun(out, status);
    } catch (err) {
      status.textContent = `refused: ${err.message}`;
    } finally {
      run.disabled = false;
    }
  });
  return el(
    "li",
    {},
    el("strong", {}, op.id),
    el("span", { className: "meta" }, `needs ${op.roles.join(" or ")}`),
    run,
    status
  );
}

async function followRun(out, status) {
  const link = out.url
    ? el("a", { href: out.url, target: "_blank", rel: "noopener" }, "open on GitHub")
    : "";
  const paint = (text) => status.replaceChildren(`${text} `, link);
  paint(out.status ?? "dispatched");
  const settled = (s) => s === "completed" || s === "pending";
  let current = out;
  for (let i = 0; i < 60 && !settled(current.status); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    current = await api(`/runs/${encodeURIComponent(out.runRef)}`);
    paint(current.conclusion ? `${current.status} (${current.conclusion})` : current.status);
  }
}

async function renderAudit() {
  if (state.me.role !== "admin") return;
  $("#audit-box").hidden = false;
  const { chain, entries } = await api("/audit?limit=50");
  $("#audit-chain").textContent = chain.ok
    ? `Chain verified: ${chain.length} entries, nothing altered.`
    : `CHAIN BROKEN at entry ${chain.at}: ${chain.reason}`;
  $("#audit").replaceChildren(
    ...entries
      .toReversed()
      .map((e) =>
        el(
          "tr",
          { className: e.outcome === "ok" ? "" : "bad" },
          el("td", {}, new Date(e.ts).toLocaleString()),
          el("td", {}, e.who?.email ?? ""),
          el("td", {}, e.action),
          el("td", {}, e.target ?? ""),
          el("td", {}, e.outcome)
        )
      )
  );
}

async function signedIn() {
  try {
    const { identity } = await api("/me");
    state.me = identity;
    const cfg = await api("/config");
    renderHome(identity, cfg);
    notice("");
    show("home");
    // A corpus that cannot be read is shown as such; it never signs the person out.
    await renderCorpora(cfg).catch((err) =>
      notice(`Corpora could not be read: ${err.message}`, "error")
    );
    renderOperations(cfg);
    await renderAudit().catch((err) =>
      notice(`Audit trail could not be read: ${err.message}`, "error")
    );
  } catch (err) {
    signOut(false);
    notice(
      err.status === 401
        ? "Your session is not valid any more — sign in again."
        : `Access refused: ${err.message}`,
      "error"
    );
  }
}

function signOut(tell = true) {
  state.token = null;
  state.me = null;
  sessionStorage.removeItem(TOKEN_KEY);
  $("#who").hidden = true;
  if (tell) notice("Signed out.");
  show("signin");
}

function loadGoogle(clientId) {
  const script = el("script", { src: "https://accounts.google.com/gsi/client", async: true });
  script.onload = () => {
    globalThis.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) => {
        state.token = credential;
        sessionStorage.setItem(TOKEN_KEY, credential);
        signedIn();
      },
    });
    globalThis.google.accounts.id.renderButton($("#gsi"), {
      theme: "outline",
      size: "large",
      text: "signin_with",
    });
  };
  script.onerror = () =>
    notice(
      "Google Sign-In could not load — check the network and the authorised origins of the OAuth client.",
      "error"
    );
  document.head.append(script);
}

async function boot() {
  $("#signout").addEventListener("click", () => signOut());
  try {
    state.status = await api("/status");
  } catch (err) {
    return notice(`The console API is not answering: ${err.message}`, "error");
  }
  $("#instance").textContent = state.status.instance;
  $("#version").textContent = `v${state.status.version}`;
  if (state.status.auth?.domains?.length)
    $("#domains").textContent = state.status.auth.domains.join(" or ");
  if (!state.status.auth?.clientId)
    return notice(
      "auth.audience is not set in console.config.json — the page needs the OAuth client id to sign people in.",
      "error"
    );
  loadGoogle(state.status.auth.clientId);
  if (state.token) await signedIn();
  else show("signin");
}

boot();
