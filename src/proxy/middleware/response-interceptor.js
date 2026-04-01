import { EventEmitter } from "node:events";

/**
 * Create a response interceptor middleware that extracts tool calls, usage data,
 * and text content from AI provider responses without buffering.
 *
 * For SSE (text/event-stream) responses, it parses each "data: " line inline.
 * For non-streaming JSON responses, it parses the completed body.
 *
 * Events emitted on the provided EventEmitter:
 *   - tool_call        {name, id}
 *   - tool_call_complete {id}
 *   - text_delta       {text}
 *   - usage            {input_tokens, output_tokens}
 *   - message_complete {}
 *
 * @param {object} [config]
 * @param {EventEmitter} [config.emitter] - EventEmitter to emit events on (created if not provided)
 * @returns {{ middleware: (ctx: object, next: () => Promise<void>) => Promise<void>, emitter: EventEmitter }}
 */
export function createResponseInterceptor(config = {}) {
  const emitter = config.emitter || new EventEmitter();

  // Track accumulated tool input per tool id
  const toolInputBuffers = new Map();

  function handleSSELine(line) {
    if (!line.startsWith("data: ")) return;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") return;

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return; // Malformed JSON, skip
    }

    processAnthropicEvent(event);
  }

  function processAnthropicEvent(event) {
    const type = event.type;

    if (type === "content_block_start") {
      const block = event.content_block;
      if (block && block.type === "tool_use") {
        toolInputBuffers.set(block.id, "");
        emitter.emit("tool_call", { name: block.name, id: block.id });
      }
    } else if (type === "content_block_delta") {
      const delta = event.delta;
      if (delta && delta.type === "input_json_delta") {
        const id = findActiveToolId(event);
        if (id && toolInputBuffers.has(id)) {
          toolInputBuffers.set(id, toolInputBuffers.get(id) + (delta.partial_json || ""));
        }
      } else if (delta && delta.type === "text_delta") {
        emitter.emit("text_delta", { text: delta.text || "" });
      }
    } else if (type === "content_block_stop") {
      const id = findActiveToolId(event);
      if (id && toolInputBuffers.has(id)) {
        toolInputBuffers.delete(id);
        emitter.emit("tool_call_complete", { id });
      }
    } else if (type === "message_delta") {
      if (event.usage) {
        emitter.emit("usage", {
          input_tokens: event.usage.input_tokens,
          output_tokens: event.usage.output_tokens,
        });
      }
    } else if (type === "message_start") {
      if (event.message && event.message.usage) {
        emitter.emit("usage", {
          input_tokens: event.message.usage.input_tokens,
          output_tokens: event.message.usage.output_tokens,
        });
      }
    } else if (type === "message_stop") {
      emitter.emit("message_complete", {});
    }
  }

  /**
   * Resolve the tool ID from the event. Anthropic events use `index` to refer
   * to the content block, but we track by id. For events with an index, we map
   * it to the id stored at creation time. To keep things simple and avoid
   * maintaining an index->id map, we accept an explicit `id` field if present
   * or fall back to the first (and often only) active tool.
   */
  function findActiveToolId(event) {
    if (event.id) return event.id;
    // Fall back to the first active tool (works for single-tool scenarios)
    const keys = [...toolInputBuffers.keys()];
    return keys.length > 0 ? keys[keys.length - 1] : null;
  }

  /**
   * Process a non-streaming JSON response body.
   */
  function processJsonBody(bodyStr) {
    let body;
    try {
      body = JSON.parse(bodyStr);
    } catch {
      return;
    }

    // Extract tool_use blocks from content array
    if (Array.isArray(body.content)) {
      for (const block of body.content) {
        if (block.type === "tool_use") {
          emitter.emit("tool_call", { name: block.name, id: block.id });
          emitter.emit("tool_call_complete", { id: block.id });
        } else if (block.type === "text") {
          emitter.emit("text_delta", { text: block.text || "" });
        }
      }
    }

    // Extract usage
    if (body.usage) {
      emitter.emit("usage", {
        input_tokens: body.usage.input_tokens,
        output_tokens: body.usage.output_tokens,
      });
    }

    emitter.emit("message_complete", {});
  }

  /**
   * Middleware function compatible with the proxy server's Koa-style middleware.
   * Wraps ctx.res.write and ctx.res.end to tap into the response stream.
   */
  async function middleware(ctx, next) {
    const origWrite = ctx.res.write.bind(ctx.res);
    const origEnd = ctx.res.end.bind(ctx.res);
    const origWriteHead = ctx.res.writeHead.bind(ctx.res);

    let isSSE = false;
    let isJSON = false;
    let lineBuf = ""; // Buffer for partial SSE lines across chunks
    const jsonChunks = []; // Accumulate non-streaming JSON body

    function processSSEChunk(text) {
      lineBuf += text;
      const lines = lineBuf.split("\n");
      // Keep the last element as it may be incomplete
      lineBuf = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          handleSSELine(trimmed);
        }
      }
    }

    // Intercept writeHead to detect content-type
    ctx.res.writeHead = function interceptWriteHead(statusCode, ...args) {
      // headers can be in args[0] (object) or args[1] with reasonPhrase in args[0]
      const headers = typeof args[0] === "object" ? args[0] : args[1];
      const ct = findHeader(headers, "content-type") || "";
      isSSE = ct.includes("text/event-stream");
      isJSON = ct.includes("application/json");
      return origWriteHead(statusCode, ...args);
    };

    // Intercept write to parse chunks inline
    ctx.res.write = function interceptWrite(chunk, encoding, callback) {
      if (isSSE) {
        processSSEChunk(typeof chunk === "string" ? chunk : chunk.toString());
      } else if (isJSON) {
        jsonChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      }
      return origWrite(chunk, encoding, callback);
    };

    // Intercept end to handle final chunk and JSON body
    ctx.res.end = function interceptEnd(chunk, encoding, callback) {
      if (chunk) {
        if (isSSE) {
          processSSEChunk(typeof chunk === "string" ? chunk : chunk.toString());
        } else if (isJSON) {
          jsonChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        }
      }
      // Flush remaining SSE buffer
      if (isSSE && lineBuf.trim()) {
        handleSSELine(lineBuf.trim());
        lineBuf = "";
      }
      // Process complete JSON body
      if (isJSON && jsonChunks.length > 0) {
        processJsonBody(jsonChunks.join(""));
      }
      return origEnd(chunk, encoding, callback);
    };

    await next();
  }

  function findHeader(headers, name) {
    if (!headers) return undefined;
    // Headers might be an object or an array of [key, value] pairs
    if (Array.isArray(headers)) {
      for (let i = 0; i < headers.length; i += 2) {
        if (typeof headers[i] === "string" && headers[i].toLowerCase() === name) {
          return headers[i + 1];
        }
      }
      return undefined;
    }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === name) return headers[key];
    }
    return undefined;
  }

  return { middleware, emitter };
}
