# Karajan Code v2 — Proxy Layer Release Notes

## Overview

v2 introduces a transparent HTTP forward proxy that sits between Karajan's agent subprocesses and AI provider APIs. The proxy enables request/response observation, compression, caching, prompt injection, and progress monitoring — all without modifying the agents themselves.

## What v2 adds

### Proxy core (`src/proxy/proxy-server.js`)
- Lightweight HTTP forward proxy bound to `127.0.0.1` (localhost-only)
- Koa-style middleware pipeline with `use()` registration
- Automatic HTTPS forwarding to upstream AI providers (Anthropic, OpenAI, Gemini)
- Graceful shutdown with active connection draining
- Health check endpoint (`/_kj/health`)
- Request body size limit (413 for payloads > 50 MB)

### Proxy lifecycle (`src/proxy/proxy-lifecycle.js`)
- `startProxy()` / `stopProxy()` with automatic free-port discovery
- Health check wait-for-ready before returning
- Orphan prevention: periodic parent-PID check auto-terminates if parent dies
- `getProxyEnv()` returns env vars (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GEMINI_API_BASE`) for agent subprocesses

### Security hardening (`src/proxy/security.js`)
- `sanitizeHeaders()` — strips `Authorization`, `x-api-key`, `x-goog-api-key` values to `[REDACTED]` for safe logging
- `isRequestTooLarge()` — Content-Length and streaming body size enforcement
- Proxy binds exclusively to `127.0.0.1`, unreachable from external network

### Response interception
- Stream-based response interceptor extracts tool calls, usage metrics, and message completion events from SSE/JSON responses
- Provider-specific adapters for Anthropic, OpenAI, and Gemini response formats

### Prompt injection
- Middleware injects system prompts or additional context into outbound API requests
- Enables adding Karajan-specific instructions (e.g., TDD rules, review guidelines) transparently

### Compression
- Multi-layer compression pipeline: git-aware diff compression, AI-powered summarization (optional)
- Reduces token usage for large context windows

### Dedup cache
- Request deduplication cache to avoid redundant API calls within a session

### Progress monitoring (`src/proxy/progress-monitor.js`)
- Bridges interceptor events (tool_call, usage, message_complete) to Karajan's structured progress event system
- Real-time token tracking per stage and provider

### Agent integration
- Proxy env vars injected into agent subprocesses automatically
- Works with all supported agents: Claude, Codex, Aider, Gemini, OpenCode

### Orchestrator wiring (`src/orchestrator.js`)
- Proxy starts after config load in `initFlowContext`, before first agent stage
- Proxy stops in `runFlow` finally block (guaranteed cleanup)
- Proxy startup is non-blocking: pipeline continues even if proxy fails to start

### RTK migration path
- RTK (Reduced Token Kit) detection wraps internal git/diff commands
- Proxy compression layers complement RTK for additional token savings

## Test coverage

244 proxy-related tests across 12 test files:
- `proxy-server.test.js` — core server, middleware, forwarding
- `proxy-lifecycle.test.js` — start/stop, health check, orphan prevention
- `proxy-adapters.test.js` — provider-specific response parsing
- `proxy-deterministic.test.js` — deterministic behavior guarantees
- `proxy-ai-compressor.test.js` — AI-powered compression
- `proxy-pipeline.test.js` — middleware pipeline composition
- `proxy-dedup-cache.test.js` — request deduplication
- `proxy-response-interceptor.test.js` — SSE/JSON response extraction
- `proxy-progress-monitor.test.js` — progress event bridging
- `proxy-config.test.js` — proxy configuration resolution
- `proxy-prompt-injector.test.js` — prompt injection middleware
- `proxy-agent-integration.test.js` — end-to-end agent integration

## Configuration

```yaml
# kj.config.yml
proxy:
  enabled: true          # default: true
  port: "auto"           # default: auto (OS-assigned)
  compression:
    enabled: true
    ai_compression: false
    layers:
      git: true
```

Disable with `--no-proxy` CLI flag or `proxy.enabled: false` in config.
