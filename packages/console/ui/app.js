// C1-UI (KJC-TSK-0785, ADR 0007) — the console page: no framework, no build.
// Google Identity Services hands over an ID token; every call carries it and
// the SERVER decides (domain, role). The UI only shows what the API answered.
const TOKEN_KEY = "karajan-console.idToken";
const state = { token: sessionStorage.getItem(TOKEN_KEY), status: null, me: null };
const $ = (selector) => document.querySelector(selector);

const el = (tag, attrs = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), attrs);
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

async function signedIn() {
  try {
    const { identity } = await api("/me");
    state.me = identity;
    renderHome(identity, await api("/config"));
    notice("");
    show("home");
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
