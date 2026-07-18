# Extra providers via OpenCode (Kimi, DeepSeek, local models…)

Karajan does not need a plugin system for new model providers: **OpenCode is
the gateway**. Any OpenAI-compatible API becomes a kj coder/reviewer by
declaring it in `~/.config/opencode/opencode.json` — the same pattern used
for local models behind a LiteLLM proxy. Cost tracking works out of the box
for the ids registered in kj's model registry (KJC-TSK-0633: Kimi K2 and
DeepSeek families).

## 1. Declare the providers

`~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "kimi": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.moonshot.ai/v1",
        "apiKey": "{env:MOONSHOT_API_KEY}"
      },
      "models": {
        "kimi-k2": {},
        "kimi-k2-thinking": {}
      }
    },
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.deepseek.com",
        "apiKey": "{env:DEEPSEEK_API_KEY}"
      },
      "models": {
        "deepseek-chat": {},
        "deepseek-reasoner": {}
      }
    }
  }
}
```

Export the keys in your shell profile (`MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY`).
Verify the exact model ids against each provider's catalog — they move fast;
the ones above are the registered defaults.

## 2. Use them in kj

```bash
# Kimi as coder
kj run --coder opencode --coder-model kimi/kimi-k2 "implement the parser"

# DeepSeek as a cheap reviewer while Claude codes
kj run --reviewer opencode --reviewer-model deepseek/deepseek-chat "fix the race"

# Persistent, in .karajan/kj.config.yml:
#   roles:
#     reviewer: { provider: opencode, model: deepseek/deepseek-chat }
```

## Cost tracking

`kimi-k2`, `kimi-k2-thinking`, `deepseek-chat` and `deepseek-reasoner` (plus
the `kimi/…` and `deepseek/…` prefixed forms this doc produces) are registered
with real pricing, so the per-HU $ badge and `max_budget_usd` enforcement work.
Prices are a static snapshot — check the provider pricing pages linked in
`src/agents/model-registry.js` before relying on them for billing decisions.

## When would a first-class agent make sense?

Only if a provider ships a mature agent CLI worth wrapping (the PR #75
OpenCode pattern). Moonshot's `kimi-cli` is a candidate to evaluate;
DeepSeek has no official agent CLI, so OpenCode/aider remains its natural
route.
