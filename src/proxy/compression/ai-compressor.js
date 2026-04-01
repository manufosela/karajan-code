/**
 * Optional AI-powered compression for content that remains large
 * after deterministic compression.
 * Calls a cheap LLM model to summarize old tool results while
 * preserving key data (file paths, error messages, numbers, status codes).
 *
 * Disabled by default. Enable via config: { enabled: true, provider, apiKey }.
 * Zero external dependencies — uses vanilla Node.js https module.
 */
import https from "node:https";

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------
const PROVIDERS = {
  anthropic: {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    defaultModel: "claude-3-5-haiku-20241022",
    costPerInputToken: 0.25 / 1_000_000,
    costPerOutputToken: 1.25 / 1_000_000,
    buildRequest(text, model, apiKey, maxOutputTokens) {
      const body = JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        messages: [{ role: "user", content: buildPrompt(text) }]
      });
      return {
        hostname: this.hostname,
        path: this.path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body
      };
    },
    parseResponse(data) {
      const content = data.content?.[0]?.text ?? "";
      const input = data.usage?.input_tokens ?? 0;
      const output = data.usage?.output_tokens ?? 0;
      return { text: content, tokensUsed: { input, output } };
    }
  },

  openai: {
    hostname: "api.openai.com",
    path: "/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    costPerInputToken: 0.15 / 1_000_000,
    costPerOutputToken: 0.6 / 1_000_000,
    buildRequest(text, model, apiKey, maxOutputTokens) {
      const body = JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text }
        ]
      });
      return {
        hostname: this.hostname,
        path: this.path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body
      };
    },
    parseResponse(data) {
      const content = data.choices?.[0]?.message?.content ?? "";
      const input = data.usage?.prompt_tokens ?? 0;
      const output = data.usage?.completion_tokens ?? 0;
      return { text: content, tokensUsed: { input, output } };
    }
  },

  gemini: {
    hostname: "generativelanguage.googleapis.com",
    defaultModel: "gemini-2.0-flash-lite",
    costPerInputToken: 0.075 / 1_000_000,
    costPerOutputToken: 0.3 / 1_000_000,
    buildRequest(text, model, apiKey, maxOutputTokens) {
      const path = `/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const body = JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(text) }] }],
        generationConfig: { maxOutputTokens }
      });
      return {
        hostname: this.hostname,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      };
    },
    parseResponse(data) {
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const input = data.usageMetadata?.promptTokenCount ?? 0;
      const output = data.usageMetadata?.candidatesTokenCount ?? 0;
      return { text: content, tokensUsed: { input, output } };
    }
  }
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT =
  "You are a compression assistant. Summarize the following tool output concisely " +
  "while preserving ALL: file paths, error messages, numbers, status codes, " +
  "exit codes, and key technical details. Remove boilerplate, repeated lines, " +
  "and verbose formatting. Output only the summary, no preamble.";

function buildPrompt(text) {
  return `${SYSTEM_PROMPT}\n\n---\n${text}`;
}

// ---------------------------------------------------------------------------
// HTTPS helper
// ---------------------------------------------------------------------------
function httpsRequest({ hostname, path, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`Invalid JSON response: ${raw.slice(0, 200)}`));
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether AI compression can be used with the given config.
 * @param {{ enabled?: boolean, provider?: string, apiKey?: string }} config
 * @returns {boolean}
 */
export function isAICompressionAvailable(config) {
  if (!config || !config.enabled) return false;
  const provider = config.provider ?? "anthropic";
  if (!PROVIDERS[provider]) return false;
  return Boolean(config.apiKey);
}

/**
 * Compress text using a cheap LLM model.
 * @param {string} text - text to compress
 * @param {{ model?: string, apiKey?: string, provider?: string, maxOutputTokens?: number, enabled?: boolean }} options
 * @returns {Promise<{ compressed: string, tokensUsed: { input: number, output: number }, cost: number }>}
 */
export async function compressWithAI(text, options = {}) {
  const { enabled = false, provider: providerName = "anthropic", apiKey, maxOutputTokens = 1024 } = options;

  // Disabled mode — return original text unchanged
  if (!enabled || !apiKey) {
    return { compressed: text, tokensUsed: { input: 0, output: 0 }, cost: 0 };
  }

  const provider = PROVIDERS[providerName];
  if (!provider) {
    return { compressed: text, tokensUsed: { input: 0, output: 0 }, cost: 0 };
  }

  const model = options.model ?? provider.defaultModel;

  try {
    const reqOpts = provider.buildRequest(text, model, apiKey, maxOutputTokens);
    const data = await httpsRequest(reqOpts);
    const { text: compressed, tokensUsed } = provider.parseResponse(data);

    if (!compressed) {
      return { compressed: text, tokensUsed: { input: 0, output: 0 }, cost: 0 };
    }

    const cost =
      tokensUsed.input * provider.costPerInputToken +
      tokensUsed.output * provider.costPerOutputToken;

    return { compressed, tokensUsed, cost };
  } catch {
    // Graceful degradation — return original text on any failure
    return { compressed: text, tokensUsed: { input: 0, output: 0 }, cost: 0 };
  }
}

/** Exported for testing */
export { PROVIDERS };
