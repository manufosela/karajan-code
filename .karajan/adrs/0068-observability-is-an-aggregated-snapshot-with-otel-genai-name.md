# Observability is an aggregated snapshot with OTel GenAI names and no content

Status: accepted
Date: 2026-11-24

## Context

The user asked on 2026-11-24 for an Observability section in the HU Board: calls per agent, model interactions, Solomon, failures, Sentinel, steward, ledger and RAG, per project, user and period, refreshed periodically or on demand, not in real time. grafana/agento11y was evaluated: its SDKs send to Grafana Cloud and ship no self-hosted backend.

## Decision

The user accepted (PG ADR, 2026-11-24) that kj observe snapshot writes .karajan/observability/snapshot.json: a versioned file (schemaVersion, generatedAt) of counters per day, project, account, provider, role and outcome, built by pure aggregators from the usage record and the repo traces, never holding prompts, code, absolute paths or keys. New traces rag.jsonl and ledger.jsonl carry metadata only. The board serves /api/observability behind its auth with a refresh on demand and every 30 minutes by default. Field names follow the OTel GenAI conventions (gen_ai.provider.name, gen_ai.request.model, gen_ai.usage.*), the contract agento11y also uses, in metadata-only mode. Alternatives: ship agento11y and Grafana Cloud (rejected: a SaaS with a token for a local view); have the board read the raw JSONL on each request (as if the code did not exist: simplest, but it couples the board to every trace format and puts content one bug away from the page).

## Consequences

The board shows observability without network or tokens and the snapshot can be privacy-scanned like any artifact. Figures are as fresh as the last refresh, not real time. Each new source needs its own aggregator before it reaches the page.
