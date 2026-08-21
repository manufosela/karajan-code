# @karajan-family/console

The admin web console of a Karajan family instance (karajan-rag + karajan-watch): access, corpus health, operations, credentials, alerts and config — for people of one Google Workspace domain, without a terminal, with every action in a hash-chained audit trail. Design: ADR 0007 in this monorepo.

**Product / instance boundary.** The console defines operations and talks to providers through adapters. The instance brings three things: `console.config.json`, credentials (never through git) and hosting. Nothing in the product knows a concrete organisation exists.

## Run

```sh
npx karajan-console serve --config console.config.json --port 8080
```

Environment: `CONSOLE_CONFIG`, `PORT`. The process authenticates to Google with Application Default Credentials (the console's own service account on Cloud Run; `gcloud auth application-default login` locally). `createConsoleApp()` is also exported as a plain express handler for Cloud Run or Firebase Functions.

## console.config.json (v1)

```json
{
  "instance": { "name": "atlas", "project": "my-gcp-project", "allowedDomains": ["example.com"] },
  "auth": { "provider": "google", "audience": "<oauth client id>" },
  "roles": { "admins": ["admin@example.com"], "operators": [], "readers": ["@example.com"] },
  "corpora": [{ "id": "code", "adapter": "gcp-cloud-run", "project": "my-gcp-project", "region": "europe-west1", "service": "atlas-code" }],
  "operations": [{ "id": "sync-docs", "adapter": "github-workflow", "repo": "org/deploy", "workflow": "sync-docs.yml", "roles": ["operator"] }],
  "secrets": [{ "id": "notion", "adapter": "github-secret", "repo": "org/deploy", "name": "NOTION_TOKEN" }],
  "configRepo": { "adapter": "config-repo", "repo": "org/deploy", "path": "karajan-watch.config.json", "watchVersion": "0.2.0" },
  "audit": { "sink": "gcs-jsonl", "bucket": "atlas-console-audit" }
}
```

Validated fail-loud at start: every principal must belong to an allowed domain, ids must be unique, every problem is listed. Roles: `reader` (health, history) < `operator` (+ operations, + watch config via PR) < `admin` (+ access, + credentials). `@domain` grants the whole domain.

## Auth

Google ID tokens verified on the server: `email_verified`, `hd` ∈ `allowedDomains` (a personal Google account has no `hd`: no organisation, no entry), `aud` when declared, and a role from the config. Every refusal is JSON and is sealed in the audit trail with what the token claimed.

## What the console's service account needs (C1)

- `roles/run.admin` on each corpus SERVICE (for `getIamPolicy` / `setIamPolicy` of `roles/run.invoker`), never at project level.
- `roles/run.invoker` on the services (to call `/health` with its own ID token).
- Write access to the audit sink only (`roles/storage.objectCreator` on the bucket, append-only).

## API (C1)

`GET /api/status` (public, minimal) · `GET /api/me` · `GET /api/config` · `GET /api/corpora` · `GET|POST|DELETE /api/corpora/:id/access[/:email]` (admin) · `GET /api/audit` (admin). Operations, credentials, watch config and the playground arrive with C2–C5.
