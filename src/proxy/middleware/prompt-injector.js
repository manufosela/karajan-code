/**
 * Prompt Injection middleware for the KJ proxy.
 *
 * Intercepts API requests and injects additional content into the system
 * prompt on-the-fly, based on registered injection fragments.
 *
 * Supports Anthropic, OpenAI, and Gemini provider formats.
 */

/**
 * Registry that holds keyed prompt-injection fragments.
 * Fragments are concatenated (newline-separated) when retrieved.
 */
export class PromptInjectionRegistry {
  /** @type {Map<string, string>} */
  #entries = new Map();

  /**
   * Register a prompt fragment under the given key.
   * Overwrites any previous value for that key.
   * @param {string} key
   * @param {string} content
   */
  register(key, content) {
    this.#entries.set(key, content);
  }

  /**
   * Remove a previously registered fragment.
   * @param {string} key
   */
  unregister(key) {
    this.#entries.delete(key);
  }

  /**
   * Return all registered fragments concatenated with newlines.
   * Returns empty string when registry is empty.
   * @returns {string}
   */
  getAll() {
    if (this.#entries.size === 0) return "";
    return [...this.#entries.values()].join("\n");
  }

  /** Remove all registered fragments. */
  clear() {
    this.#entries.clear();
  }
}

/**
 * Inject content into the system prompt for a given provider.
 * Mutates the parsed body object in-place.
 *
 * @param {object} parsed - Parsed JSON request body
 * @param {string} content - Content to inject
 * @param {string} provider - "anthropic" | "openai" | "gemini"
 */
function injectSystemPrompt(parsed, content, provider) {
  switch (provider) {
    case "anthropic":
      injectAnthropic(parsed, content);
      break;
    case "openai":
      injectOpenAI(parsed, content);
      break;
    case "gemini":
      injectGemini(parsed, content);
      break;
    default:
      // Unknown provider — attempt OpenAI-style as a sensible default
      injectOpenAI(parsed, content);
      break;
  }
}

/**
 * Anthropic: body.system is either a string or an array of content blocks.
 */
function injectAnthropic(parsed, content) {
  if (typeof parsed.system === "string") {
    parsed.system = parsed.system + "\n" + content;
  } else if (Array.isArray(parsed.system)) {
    parsed.system.push({ type: "text", text: content });
  } else {
    // No system prompt yet — create one
    parsed.system = content;
  }
}

/**
 * OpenAI: messages[0] with role "system". Append to its content.
 */
function injectOpenAI(parsed, content) {
  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
    parsed.messages = [{ role: "system", content }];
    return;
  }

  const first = parsed.messages[0];
  if (first.role === "system") {
    first.content = (first.content || "") + "\n" + content;
  } else {
    // No system message — prepend one
    parsed.messages.unshift({ role: "system", content });
  }
}

/**
 * Gemini: body.systemInstruction.parts — append a new text part.
 */
function injectGemini(parsed, content) {
  if (!parsed.systemInstruction) {
    parsed.systemInstruction = { parts: [{ text: content }] };
    return;
  }

  if (!Array.isArray(parsed.systemInstruction.parts)) {
    parsed.systemInstruction.parts = [];
  }

  parsed.systemInstruction.parts.push({ text: content });
}

/**
 * Create a proxy middleware that injects prompt fragments from the registry
 * into every API request's system prompt.
 *
 * @param {PromptInjectionRegistry} registry
 * @returns {(ctx: object, next: () => Promise<void>) => Promise<void>}
 */
export function createPromptInjector(registry) {
  return async function promptInjectorMiddleware(ctx, next) {
    const content = registry.getAll();

    // Nothing to inject — pass through unchanged
    if (!content) {
      return next();
    }

    // Only intercept POST requests with a body
    if (ctx.req.method !== "POST" || !ctx.body) {
      return next();
    }

    let parsed;
    try {
      parsed = JSON.parse(ctx.body);
    } catch {
      // Not valid JSON — pass through
      return next();
    }

    injectSystemPrompt(parsed, content, ctx.provider);

    const modified = JSON.stringify(parsed);
    ctx.modifiedBody = modified;

    // Recalculate Content-Length for the modified body
    ctx.req.headers["content-length"] = String(Buffer.byteLength(modified));

    return next();
  };
}
