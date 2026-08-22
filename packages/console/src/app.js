// C0 (KJC-TSK-0776, ADR 0007) — the console as a plain express app: exportable
// as a handler (Cloud Run, Firebase Functions) or served by the bin. C0 wires
// auth + audit + adapters and exposes what the UI needs to exist: status, me,
// the public view of the config, the audit trail (admin). Operations come
// with C1+. Every refusal is JSON; denied auth attempts are sealed.
import express from "express";
import { fileURLToPath } from "node:url";
import { createAuth, AuthError, ROLE_RANK } from "./auth.js";
import { createAudit, sinkFromConfig, looksSecret } from "./audit.js";
import { createRegistry, memoryAdapter } from "./adapters/registry.js";

export const CONSOLE_VERSION = "0.2.0";

const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));

export function createConsoleApp({ config, verify, sink, adapters = {}, gcpAuth = null, ui = true }) {
  const auth = createAuth({ config, verify });
  const audit = createAudit({ sink: sink ?? sinkFromConfig(config.audit, { auth: gcpAuth }) });
  const registry = createRegistry({ memory: memoryAdapter(), ...adapters });
  const missing = registry.missingFor(config);
  // An async sink (gcs-jsonl) loads its chain first: nothing is served before the trail is known.
  const ready = audit.ready();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (_req, _res, next) => { ready.then(() => next(), next); });

  // Public and minimal: enough for a health check, nothing an outsider can use.
  // The OAuth client id is public by nature (it is in every sign-in page); the domains tell the page whom to invite.
  app.get("/api/status", (_req, res) => res.json({ ok: true, instance: config.instance.name, version: CONSOLE_VERSION, adapters: { registered: registry.names(), missing }, auth: { provider: config.auth.provider, clientId: config.auth.audience ?? null, domains: config.instance.allowedDomains } }));

  // Auth refusals are audited with whatever the token claimed (or "anonymous").
  const guard = (role) => auth.requireRole(role);
  app.use("/api", (req, res, next) => {
    if (req.path === "/status") return next();
    const send = res.json.bind(res);
    res.json = (body) => {
      if (body?.ok === false && body.code && res.statusCode >= 401 && res.statusCode <= 403) {
        // The refusal is already on its way; a seal that fails here is shouted, never swallowed.
        Promise.resolve()
          .then(() => audit.record({ who: { email: body.email || "anonymous", role: null }, action: "auth", target: req.path, outcome: "denied", detail: { code: body.code } }))
          .catch((err) => console.error(`karajan-console: denied auth attempt NOT sealed in the audit trail: ${err.message}`));
      }
      return send(body);
    };
    next();
  });

  app.get("/api/me", guard("reader"), (req, res) => res.json({ ok: true, identity: req.identity }));
  // Secret handles (ids, adapters — never the secret NAMES or values) are admin business only;
  // a reader sees how many exist (review catch).
  app.get("/api/config", guard("reader"), (req, res) => res.json({
    ok: true,
    instance: { name: config.instance.name, allowedDomains: config.instance.allowedDomains },
    corpora: config.corpora.map(({ id, name, adapter }) => ({ id, name: name ?? id, adapter, available: !missing.includes(adapter) })),
    operations: config.operations.map(({ id, adapter, roles }) => ({ id, adapter, roles, available: !missing.includes(adapter) })),
    secrets: req.identity.role === "admin" ? config.secrets.map(({ id, adapter }) => ({ id, adapter })) : { count: config.secrets.length },
    configRepo: config.configRepo ? { repo: config.configRepo.repo, path: config.configRepo.path, watchVersion: config.configRepo.watchVersion } : null,
    audit: { sink: config.audit.sink },
  }));
  app.get("/api/audit", guard("admin"), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    res.json({ ok: true, chain: audit.verify(), entries: audit.entries().slice(-limit) });
  });

  // C1 (KJC-TSK-0777): corpora health (reader) and access as the service's invoker binding (admin, audited).
  const corpusOf = (req, res) => {
    const c = config.corpora.find((x) => x.id === req.params.id);
    if (!c) res.status(404).json({ ok: false, error: `no such corpus "${req.params.id}"` });
    return c ?? null;
  };
  const adapterFor = (corpus, capability, res) => {
    try { return registry.demand(corpus.adapter, capability); } catch (err) { res.status(503).json({ ok: false, error: err.message }); return null; }
  };
  const inDomain = (email) => config.instance.allowedDomains.some((d) => String(email).toLowerCase().endsWith(`@${d.toLowerCase()}`));
  const act = async (req, res, action, target, fn) => {
    try { res.json({ ok: true, ...(await audit.wrap({ who: req.identity, action, target }, fn)) }); }
    catch (err) { res.status(502).json({ ok: false, error: String(err?.message || err) }); }
  };

  app.get("/api/corpora", guard("reader"), async (_req, res) => {
    const corpora = await Promise.all(config.corpora.map(async (c) => {
      const base = { id: c.id, name: c.name ?? c.id, adapter: c.adapter };
      try { return { ...base, ...(await registry.demand(c.adapter, "health").health(c)) }; }
      catch (err) { return { ...base, ok: false, error: String(err?.message || err) }; }
    }));
    res.json({ ok: true, corpora });
  });
  app.get("/api/corpora/:id/access", guard("admin"), async (req, res) => {
    const c = corpusOf(req, res); if (!c) return;
    const a = adapterFor(c, "listAccess", res); if (!a) return;
    try { res.json({ ok: true, corpus: c.id, members: await a.listAccess(c) }); }
    catch (err) { res.status(502).json({ ok: false, error: String(err?.message || err) }); }
  });
  app.post("/api/corpora/:id/access", guard("admin"), async (req, res) => {
    const c = corpusOf(req, res); if (!c) return;
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !inDomain(email)) return res.status(400).json({ ok: false, error: `email must belong to ${config.instance.allowedDomains.join(", ")}` });
    const a = adapterFor(c, "grant", res); if (!a) return;
    await act(req, res, "access.grant", `corpus:${c.id}`, async () => ({ ...(await a.grant(c, email)), audit: { principal: email } }));
  });
  // Revoke deliberately skips the domain check: removing an OUTSIDER that somehow
  // got onto the binding is exactly what an admin must be able to do. Only grant is gated.
  app.delete("/api/corpora/:id/access/:email", guard("admin"), async (req, res) => {
    const c = corpusOf(req, res); if (!c) return;
    const email = String(req.params.email).toLowerCase();
    const a = adapterFor(c, "revoke", res); if (!a) return;
    await act(req, res, "access.revoke", `corpus:${c.id}`, async () => ({ ...(await a.revoke(c, email)), audit: { principal: email } }));
  });

  // C2 (KJC-TSK-0778): operations are workflow runs — listed for readers, dispatched only by the roles the
  // operation names (admin qualifies by rank), every dispatch sealed with its inputs; runs read by their ref.
  const adapterOfRef = (ref) => (ref.startsWith("github:") ? "github-workflow" : ref.startsWith("memory:") ? "memory" : null);
  const runOf = async (req, res, capability) => {
    const ref = String(req.params.ref);
    const name = adapterOfRef(ref);
    if (!name) { res.status(400).json({ ok: false, error: `not a run ref "${ref}"` }); return null; }
    try { return { ref, adapter: registry.demand(name, capability) }; } catch (err) { res.status(503).json({ ok: false, error: err.message }); return null; }
  };
  app.get("/api/operations", guard("reader"), (_req, res) => res.json({ ok: true, operations: config.operations.map(({ id, adapter, repo, workflow, ref, roles }) => ({ id, adapter, repo, workflow, ref, roles, available: !missing.includes(adapter) })) }));
  app.post("/api/operations/:id/dispatch", guard("operator"), async (req, res) => {
    const op = config.operations.find((x) => x.id === req.params.id);
    if (!op) return res.status(404).json({ ok: false, error: `no such operation "${req.params.id}"` });
    if (!op.roles.some((r) => ROLE_RANK[req.identity.role] >= ROLE_RANK[r])) return res.status(403).json({ ok: false, error: `operation "${op.id}" needs ${op.roles.join(" or ")}`, code: "forbidden", email: req.identity.email });
    const inputs = req.body?.inputs ?? {};
    const malformed = typeof inputs !== "object" || Array.isArray(inputs) || Object.keys(inputs).length > 20 || Object.values(inputs).some((x) => typeof x !== "string" || x.length > 1000);
    if (malformed) return res.status(400).json({ ok: false, error: "inputs must be an object of at most 20 string values (1000 chars each at most)" });
    // Inputs go into the trail, so an input that looks like a secret is refused HERE — before any adapter sees it.
    const leak = looksSecret(inputs);
    if (leak) return res.status(400).json({ ok: false, error: `inputs.${leak} looks like a secret — secrets never travel through the console` });
    const a = adapterFor(op, "dispatch", res); if (!a) return;
    await act(req, res, "operation.dispatch", `operation:${op.id}`, async () => ({ ...(await a.dispatch(op, inputs)), audit: { inputs } }));
  });
  app.get("/api/runs/:ref", guard("reader"), async (req, res) => {
    const run = await runOf(req, res, "runStatus"); if (!run) return;
    try { res.json({ ok: true, ...(await run.adapter.runStatus(run.ref)) }); } catch (err) { res.status(502).json({ ok: false, error: String(err?.message || err) }); }
  });
  app.get("/api/runs/:ref/log", guard("reader"), async (req, res) => {
    const run = await runOf(req, res, "runLog"); if (!run) return;
    try { res.json({ ok: true, runRef: run.ref, log: await run.adapter.runLog(run.ref) }); } catch (err) { res.status(502).json({ ok: false, error: String(err?.message || err) }); }
  });

  app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "no such endpoint" }));
  // C1-UI (KJC-TSK-0785): the page itself — static files, no build; `ui: false` for API-only deployments.
  if (ui) app.use(express.static(UI_DIR, { index: "index.html", fallthrough: true }));
  app.use((err, _req, res, _next) => {
    if (err instanceof AuthError) return res.status(err.status).json({ ok: false, error: err.message, code: err.code });
    res.status(500).json({ ok: false, error: "internal error" });
  });

  return Object.assign(app, { console: { auth, audit, registry, missing } });
}
