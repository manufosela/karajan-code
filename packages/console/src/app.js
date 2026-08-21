// C0 (KJC-TSK-0776, ADR 0007) — the console as a plain express app: exportable
// as a handler (Cloud Run, Firebase Functions) or served by the bin. C0 wires
// auth + audit + adapters and exposes what the UI needs to exist: status, me,
// the public view of the config, the audit trail (admin). Operations come
// with C1+. Every refusal is JSON; denied auth attempts are sealed.
import express from "express";
import { createAuth, AuthError } from "./auth.js";
import { createAudit, sinkFromConfig } from "./audit.js";
import { createRegistry, memoryAdapter } from "./adapters/registry.js";

export const CONSOLE_VERSION = "0.0.1";

export function createConsoleApp({ config, verify, sink, adapters = {} }) {
  const auth = createAuth({ config, verify });
  const audit = createAudit({ sink: sink ?? sinkFromConfig(config.audit) });
  const registry = createRegistry({ memory: memoryAdapter(), ...adapters });
  const missing = registry.missingFor(config);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  // Public and minimal: enough for a health check, nothing an outsider can use.
  app.get("/api/status", (_req, res) => res.json({ ok: true, instance: config.instance.name, version: CONSOLE_VERSION, adapters: { registered: registry.names(), missing } }));

  // Auth refusals are audited with whatever the token claimed (or "anonymous").
  const guard = (role) => auth.requireRole(role);
  app.use("/api", (req, res, next) => {
    if (req.path === "/status") return next();
    const send = res.json.bind(res);
    res.json = (body) => {
      if (body?.ok === false && body.code && res.statusCode >= 401 && res.statusCode <= 403) {
        audit.record({ who: { email: body.email || "anonymous", role: null }, action: "auth", target: req.path, outcome: "denied", detail: { code: body.code } });
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

  app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "no such endpoint" }));
  app.use((err, _req, res, _next) => {
    if (err instanceof AuthError) return res.status(err.status).json({ ok: false, error: err.message, code: err.code });
    res.status(500).json({ ok: false, error: "internal error" });
  });

  return Object.assign(app, { console: { auth, audit, registry, missing } });
}
