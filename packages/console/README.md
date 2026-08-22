# @karajan-family/console

The admin web console of a Karajan family instance (karajan-rag + karajan-watch): access, corpus health, operations, credentials, alerts and config — for people of one Google Workspace domain, without a terminal, with every action in a hash-chained audit trail. Design: ADR 0007 in this monorepo.

**Product / instance boundary.** The console defines operations and talks to providers through adapters. The instance brings three things: `console.config.json`, credentials (never through git) and hosting. Nothing in the product knows a concrete organisation exists.

## Run

```sh
npx karajan-console serve --config console.config.json --port 8080
```

Environment: `CONSOLE_CONFIG`, `PORT`. The process authenticates to Google with Application Default Credentials (the console's own service account on Cloud Run; `gcloud auth application-default login` locally — with user ADC also set `GOOGLE_CLOUD_QUOTA_PROJECT=<project>`, or IAM calls answer 403). `createConsoleApp()` is also exported as a plain express handler for Cloud Run or Firebase Functions.

Audit sink for Cloud Run / Functions (ephemeral filesystem): `"audit": { "sink": "gcs-jsonl", "bucket": "<bucket>" }` — one immutable object per entry, chain rebuilt from the bucket at start, a refused upload is a 502 and never a sealed entry; entries are sealed one at a time per process, so concurrent requests never chain on the same predecessor. Run ONE console instance per bucket (`max_instances=1` on Cloud Run): the chain lives in the process and two instances would race each other. `file` and `memory` are for a VM or tests.

Field notes from the first instance (Cloud Run, image = this bin with the config baked in): do NOT set `GOOGLE_CLOUD_QUOTA_PROJECT` on the service — with a quota-project header the service account also needs `serviceusage.services.use` and the sink answers 403; the variable is for user ADC on a laptop only. Tag the image with a hash of `console.config.json` (never `:latest`) so a config change produces a new revision — a stale `auth.audience` rejects every token with `wrong_audience` until the image is rebuilt.

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

## The page

`karajan-console serve` also serves the console page at `/` (plain HTML + JS, no build; `createConsoleApp({ ui: false })` for an API-only process). Sign-in uses Google Identity Services with the OAuth client id in `auth.audience` — create a "Web application" OAuth client in the instance's Google Cloud project and add the console's origin (the Hosting domain, `http://localhost:8080` locally) to its authorised JavaScript origins. With Firebase Hosting, rewrite `/api/**` to the function and let Hosting serve the page from the same origin: no CORS to open.

## Auth

Two providers, chosen with `auth.provider`. Either way the console decides on the server: `hd` ∈ `allowedDomains` (a personal Google account has no `hd`: no organisation, no entry) and a role from `console.config.json`. Every refusal is JSON and is sealed in the audit trail with what the token claimed.

- **`google`** (default): Google Sign-In in the page. Google ID tokens verified against Google's keys — `email_verified`, `aud` = `auth.audience` when declared. Needs an OAuth client "Web application" created by hand with the console's origin among its authorised JavaScript origins.
- **`iap`**: Identity-Aware Proxy in front of the service, provisioned entirely by infrastructure — no OAuth client, no Firebase. The assertion in `x-goog-iap-jwt-assertion` is verified against Google's public keys, IAP as issuer, and `auth.audience` = `/projects/<project NUMBER>/locations/<region>/services/<service>` (or `/projects/<number>/global/backendServices/<id>` behind a load balancer). The audience is **required**: without it any IAP token of the organisation would be accepted, and if it is wrong every request is a silent 401. The page does not load Google Sign-In and signing out uses IAP's own logout.

The console verifies the assertion **even behind IAP**: a header is not trusted for coming from a proxy, so reaching the service by another path grants nothing. And `allowedDomains` is never delegated — IAP letting someone through does not make them a user of this console.

## What the console's service account needs (C1)

- `roles/run.admin` on each corpus SERVICE (for `getIamPolicy` / `setIamPolicy` of `roles/run.invoker`), never at project level.
- `roles/run.invoker` on the services (to call `/health` with its own ID token).
- On the audit bucket: `roles/storage.objectCreator` (append) and `roles/storage.objectViewer` (rebuild the chain at start) — never delete.

## API (C1)

`GET /api/status` (public, minimal) · `GET /api/me` · `GET /api/config` · `GET /api/corpora` · `GET|POST|DELETE /api/corpora/:id/access[/:email]` (admin) · `GET /api/audit` (admin). Credentials, watch config and the playground arrive with C3–C5.

## Operations (C2)

An operation is a `workflow_dispatch` run in the deployment repo, fired by the console as a **GitHub App installation** (short-lived token minted from an RS256 JWT — never a PAT). The instance brings the App: `github: { appId, installationId }` in the config and the private key in the environment, `CONSOLE_GITHUB_APP_KEY` (PEM, `\n` escapes honoured) or `CONSOLE_GITHUB_APP_KEY_FILE` — a key in the config is a validation error, and operations without a key stop the start. The App needs `actions: write` on the deployment repo (and `contents: read`).

`GET /api/operations` (reader) · `POST /api/operations/:id/dispatch` `{ "inputs": { "corpus": "docs" } }` — only the roles the operation names (admin always qualifies); inputs are strings and go into the audit trail, so an input that looks like a secret is refused before any adapter sees it · `GET /api/runs/:ref` and `GET /api/runs/:ref/log` (reader; the ref URL-encoded, e.g. `github%3Aorg%2Fatlas%3A777`). When GitHub has not shown the run yet the ref is `github:<repo>:pending:<instant>` and its status is `pending` — the workflow page is the place to look.
