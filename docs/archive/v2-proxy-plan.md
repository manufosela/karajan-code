# Karajan v2: Native API Proxy — Implementation Plan

## Overview

Lightweight HTTP forward proxy (vanilla Node.js, zero external dependencies) that sits between AI CLIs and provider APIs. Auto-started by `kj run`, transparent for the user.

```
CLI (claude/codex/gemini/aider) → localhost:PORT (KJ Proxy) → api.anthropic.com / api.openai.com / ...
```

## What it enables

1. **Native context compression** without RTK or Squeezr
2. **Reading agent responses** directly from HTTP stream (eliminates stderr/stdout parsing)
3. **System prompt injection** on-the-fly (role templates, domain context, TDD, skills)
4. **Real-time progress monitoring** via tool call interception (replaces kj-tail log watching)
5. **Token usage tracking** from actual API response headers, per agent per stage
6. **Cross-turn deduplication** via content hashing (KV cache warming)
7. **Adaptive compression** pressure based on context utilization

## What it eliminates

- RTK as external dependency (compression is native)
- stderr/stdout parsing hack for Claude (reads from HTTP stream)
- kj-tail log file watching (intercepts tool calls directly)

## What it keeps (CLI-level, not HTTP-level)

- `CLAUDECODE` env var strip
- `stdin: "ignore"`
- `--allowedTools` for Claude

## Architecture

### Provider adapters

```js
// Adapter contract — one per provider
const adapter = {
  // Extract tool_results from provider-specific message format
  extractToolResults(messages) → [{id, toolName, text, turnIndex}],
  // Rebuild messages replacing compressed text
  rebuildMessages(messages, compressedMap) → messages
}
```

Three adapters:
- **Anthropic**: `message.content[]` where `content.type === "tool_result"`
- **OpenAI**: `messages` with `role === "tool"`
- **Gemini**: `parts[]` with `functionResponse`

### Compression pipeline (5 steps)

```
extract → dedup → deterministic → ai-compress → rebuild
```

1. **Extract**: adapter pulls tool_results from messages (normalized format)
2. **Dedup**: if a file was read multiple times, only keep the most recent at full fidelity
3. **Deterministic**: apply known patterns (git, tests, build...). Free, no API call
4. **AI-compress** (optional): what remains large goes to a cheap model for summarization
5. **Rebuild**: adapter reconstructs messages in the provider's original format

### Adaptive pressure

`estimatePressure(messages)` calculates available context and adjusts aggressiveness:
- Low (<50% used): only compress very large tool_results
- Medium (50-80%): compress everything above threshold
- High (>80%): aggressive compression, shorter summaries
- Critical (>90%): maximum compression, keep only essential data

### Cache (two levels)

1. **Compression cache**: `hash(original_text) → compressed_text`. Avoids re-compressing.
2. **Session cache**: keeps identical strings across requests to preserve LLM KV cache.

Both caches persist to disk with debounce (not on every request):
```js
createPersistScheduler(flushFn, intervalMs = 5000)
// markDirty() → schedules flush after interval (trailing-edge)
// flush() → immediate write (for shutdown)
// Register flush() on SIGTERM and SIGINT
```

## Implementation Steps

### Phase 1: Core Proxy (steps 1-2)

**Step 1** — `src/proxy/proxy-server.js`
Core HTTP proxy server. Vanilla Node.js `http` module, zero dependencies.
- `createProxyServer({port, targetHosts})` listens on localhost
- Request interception pipeline with before/after middleware hooks
- TLS tunneling via CONNECT for HTTPS endpoints
- Streaming response forwarding (preserves SSE/chunked encoding)
- Health check at `/_kj/health`
- Graceful shutdown with connection draining

Commit: `feat(proxy): add core HTTP/HTTPS forward proxy server with middleware pipeline`

**Step 2** — `src/proxy/proxy-lifecycle.js`
Proxy lifecycle manager.
- `startProxy({config, sessionId})` finds free port, starts proxy, waits for health check, returns `{port, pid, baseUrls}`
- `stopProxy()` with graceful shutdown + SIGKILL fallback
- Environment injection: `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GEMINI_API_BASE` pointing to `localhost:PORT`
- Orphan prevention: proxy exits if parent dies (parent PID monitoring)
- Wire into orchestrator.js: start before first stage, stop after last stage

Commit: `feat(proxy): add lifecycle manager with auto-start/stop and env injection`

### Phase 2: Compression Engine (steps 3-7)

**Step 3** — `src/proxy/adapters/`
Provider adapters for message format normalization.
- `anthropic.js` — extract/rebuild for Anthropic message format
- `openai.js` — extract/rebuild for OpenAI format
- `gemini.js` — extract/rebuild for Gemini format
- Auto-detect provider from request URL/Host header

Commit: `feat(proxy): add provider adapters for Anthropic, OpenAI, Gemini message formats`

**Step 4** — `src/proxy/compression/deterministic/`
Deterministic compression patterns. Each module exports `looksLike(text) → boolean` and `compact(text) → string`.

- `bash-git.js` — git status (keep modified/untracked only), git diff (collapse large hunks), git log (short hash + first line), git branch (compact list)
- `bash-test.js` — vitest/jest/mocha (failed with error, passed as count), playwright (selectors + errors), pytest (FAILED/ERROR with short traceback), cargo test/go test (same pattern)
- `bash-build.js` — tsc (errors with file:line only), eslint/prettier (errors/warnings with location), next build/webpack (errors only, collapse progress/chunks)
- `bash-infra.js` — docker ps/images/logs (compact tables, truncate logs), kubectl (compact lists, keep state + errors), terraform plan/apply (changes only)
- `bash-pkg.js` — npm/yarn/pnpm install (collapse dep tree to count), npm list (truncate deep tree), npm outdated (compact table)
- `bash-misc.js` — curl/wget (status + relevant headers), gh CLI (compact PR/issue lists), npx (compact output)
- `grep.js` — collapse repetitive results, keep first N per file + total count
- `read.js` — multi-read dedup: only most recent at full fidelity, earlier ones summarized
- `glob.js` — truncate long file listings, keep count
- `utils.js` — `stripAnsi()`, `collapseWhitespace()`, `truncateLines(text, max)`, `dedup(items)`, `countTokens(text)` (chars/4 approximation)

Commit: `feat(proxy): add deterministic compression patterns for git, tests, build, infra, packages`

**Step 5** — `src/proxy/compression/ai-compressor.js`
Optional AI compression for remaining large content.
- Calls cheap model (Haiku/GPT-4o-mini/Gemini Flash/Ollama local) to summarize
- Only triggers when deterministic compression leaves content above threshold
- Configurable: `proxy.ai_compression: true/false`, `proxy.ai_model: "haiku"`
- Can be disabled entirely (deterministic-only mode, zero cost)

Commit: `feat(proxy): add optional AI compression layer with cheap model summarization`

**Step 6** — `src/proxy/compression/pipeline.js`
Compression pipeline orchestrator.
- `compressRequest(messages, adapter, config)` runs the 5-step pipeline
- Adaptive pressure via `estimatePressure(messages)`
- Compression cache (hash → compressed) with disk persistence
- Session cache (identical strings for KV cache warming)
- `createPersistScheduler()` with debounce and SIGTERM/SIGINT flush
- Statistics tracking: original vs compressed tokens, cache hits, compression ratio

Commit: `feat(proxy): add 5-step compression pipeline with adaptive pressure and dual cache`

**Step 7** — `src/proxy/compression/dedup-cache.js`
Cross-turn content deduplication.
- LRU cache of content hashes (SHA-256)
- If same content seen from prior turn and >200 tokens, replace with reference marker
- `[Content from turn {N}, hash {short}, {size} tokens — unchanged]`
- Cache resets between sessions

Commit: `feat(proxy): add cross-turn content deduplication with LRU hash cache`

### Phase 3: Response Interception (steps 8-10)

**Step 8** — `src/proxy/middleware/response-interceptor.js`
Read agent responses directly from HTTP stream.
- Intercept SSE (text/event-stream) and chunked JSON responses
- Extract: assistant text, tool_use blocks (name, input, id), usage (input/output tokens), stop_reason
- Emit events: `tool_call`, `text_delta`, `usage`, `message_complete`
- Replaces stdout/stderr parsing for Claude (eliminates `pickOutput` workaround)

Commit: `feat(proxy): add response stream interceptor for tool calls and usage extraction`

**Step 9** — `src/proxy/middleware/prompt-injector.js`
System prompt injection on-the-fly.
- Intercept POST requests, locate system prompt (provider-specific)
- Prepend/append injectable blocks from PromptInjectionRegistry
- Content: role template, domain context, TDD instructions, coding standards, skills
- Recalculate Content-Length header
- Roles populate the registry before agent execution

Commit: `feat(proxy): add system prompt injection middleware with provider-specific parsing`

**Step 10** — `src/proxy/progress-monitor.js`
Real-time progress monitoring via tool call interception.
- Subscribe to response interceptor `tool_call` events
- Emit structured progress events (same interface as kj-tail)
- Log tool name, truncated input, timing
- Running tool call count per agent per stage
- Add `proxy_monitor` event type to existing event system

Commit: `feat(proxy): add real-time progress monitor via tool call interception`

### Phase 4: Integration (steps 11-14)

**Step 11** — Agent integration
Modify agent subprocess layer to use proxy.
- `claude-agent.js`: set `ANTHROPIC_BASE_URL` in env, optionally read from proxy stream instead of stderr
- `codex-agent.js`: set `OPENAI_BASE_URL` in env
- `gemini-agent.js`: set `GEMINI_API_BASE` in env
- `aider-agent.js`: add `--api-base` flag
- `opencode-agent.js`: set appropriate env var
- Fallback: if proxy is down, agents work directly (v1 behavior)

Commit: `feat(proxy): integrate proxy with agent subprocess layer`

**Step 12** — RTK migration
Replace RTK wrapper with proxy-native compression.
- Remove RTK wrapping logic from roles (coder-role.js, etc.)
- Remove RTK prompt instructions (rtk-snippet.js)
- Keep RTK detection in doctor for informational purposes
- Proxy compression is strictly better: covers all tool results, not just Bash

Commit: `refactor(roles): migrate from RTK wrapper to proxy-native compression`

**Step 13** — Configuration
Add proxy section to `kj.config.yml`:
```yaml
proxy:
  enabled: true          # auto-start proxy on kj run
  port: auto             # random free port
  compression:
    enabled: true
    ai_compression: false  # opt-in: use cheap model for remaining large content
    ai_model: haiku        # haiku | gpt-4o-mini | gemini-flash | ollama
    layers:
      git: true
      tests: true
      build: true
      infra: true
      packages: true
      read_dedup: true
      glob_truncate: true
      grep_collapse: true
    pressure_thresholds:
      low: 0.5
      medium: 0.8
      high: 0.9
  cache:
    persist_to_disk: true
    flush_interval_ms: 5000
  inject_prompts: true    # inject role/domain/skills into system prompt
  monitor: true           # real-time tool call monitoring
```

Commit: `feat(config): add proxy configuration schema with per-layer toggles`

**Step 14** — Diagnostics
- `kj doctor`: check proxy can start, verify provider API reachability through proxy
- `kj status`: show proxy stats (compression ratio, cache hits, tokens saved)
- `kj report`: include proxy metrics alongside existing session data

Commit: `feat(mcp): add proxy diagnostics to kj_doctor, kj_status, kj_report`

### Phase 5: Quality + Release (steps 15-17)

**Step 15** — Tests
- `tests/proxy/proxy-server.test.js` — HTTP forwarding, HTTPS tunneling, middleware chain
- `tests/proxy/adapters/*.test.js` — extract + rebuild roundtrip per provider
- `tests/proxy/compression/deterministic/*.test.js` — known input → expected output per pattern
- `tests/proxy/compression/pipeline.test.js` — full pipeline with mocks
- `tests/proxy/compression/dedup-cache.test.js` — hash, LRU eviction, turn references
- `tests/proxy/response-interceptor.test.js` — SSE parsing, tool_call extraction
- `tests/proxy/prompt-injector.test.js` — injection per provider format
- `tests/proxy/progress-monitor.test.js` — event emission
- `tests/proxy/persist-scheduler.test.js` — debounce with fake timers
- Coverage targets: pipeline >90%, deterministic >80%, proxy >70%

Commit: `test(proxy): add comprehensive unit and integration tests`

**Step 16** — Security review
- API keys always in headers (Authorization, x-goog-api-key), never in URL query params
- No logging of keys or sensitive content
- Proxy binds to localhost only (not exposed to network)
- Request validation: reject malformed requests, size limits

Commit: `feat(proxy): add security hardening (localhost-only, no key logging, request validation)`

**Step 17** — Documentation + version bump
- `docs/architecture/proxy.md` — proxy layer explanation, data flow diagrams
- `docs/troubleshooting.md` — proxy-specific issues
- Update README, landing, CHANGELOG
- Bump to `v2.0.0-alpha.1`

Commit: `docs: add proxy architecture documentation, bump to v2.0.0-alpha.1`

## Risks

1. **HTTPS tunneling complexity**: provider APIs use TLS. The proxy needs CONNECT method or TLS termination. Node.js `http` module handles this but requires careful implementation.
2. **SSE stream parsing**: Anthropic uses SSE for streaming. Parsing partial chunks correctly is tricky (split events, incomplete lines).
3. **Claude CLAUDECODE env var**: even with the proxy, Claude CLI checks this env var before making any API call. This workaround remains.
4. **Provider API format changes**: if Anthropic/OpenAI change their message format, adapters break. Mitigated by adapter tests.
5. **Latency**: proxy adds ~1ms per request (local forwarding). Negligible for LLM calls that take seconds.

## Migration path

- v2.0.0-alpha.1: proxy available, opt-in (`proxy.enabled: true`)
- v2.0.0-beta.1: proxy enabled by default, RTK still supported as fallback
- v2.0.0: proxy is the default compression layer, RTK optional companion
- v1.x agents continue working if proxy disabled (backward compatible)

## Dependencies

- Zero external npm dependencies (vanilla Node.js http, https, crypto, fs)
- Node.js >= 18 (already required by karajan-code)
- Optional: cheap LLM API key for AI compression layer (Haiku/GPT-4o-mini)
