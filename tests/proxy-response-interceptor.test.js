import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createResponseInterceptor } from "../src/proxy/middleware/response-interceptor.js";
import { createProxyServer } from "../src/proxy/proxy-server.js";

/**
 * Helper: start a fake upstream HTTP server.
 */
function createFakeUpstream(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      handler(req, res, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** Helper: make an HTTP request and collect the full response. */
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("response-interceptor", () => {
  let upstream;
  let proxy;

  afterEach(async () => {
    if (proxy) await proxy.close();
    if (upstream) await new Promise((r) => upstream.server.close(r));
  });

  /**
   * Helper: set up upstream + proxy with the response interceptor.
   * Returns the emitter for asserting events.
   */
  async function setup(upstreamHandler) {
    upstream = await createFakeUpstream(upstreamHandler);
    const emitter = new EventEmitter();
    const { middleware } = createResponseInterceptor({ emitter });

    proxy = createProxyServer({
      port: 0,
      targetHosts: { "api.anthropic.com": "anthropic" },
      _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
    });
    proxy.use(middleware);
    await proxy.listen();

    return emitter;
  }

  function makeRequest(proxyPort, body) {
    return httpRequest(
      {
        hostname: "127.0.0.1",
        port: proxyPort,
        path: "/v1/messages",
        method: "POST",
        headers: {
          host: "api.anthropic.com",
          "content-type": "application/json",
        },
      },
      body,
    );
  }

  describe("SSE parsing", () => {
    it("extracts tool_call events from SSE stream", async () => {
      const events = [];
      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"read_file"}}\n\n',
        );
        res.write(
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\""}}\n\n',
        );
        res.write('data: {"type":"content_block_stop","index":0}\n\n');
        res.end();
      });

      emitter.on("tool_call", (e) => events.push({ type: "tool_call", ...e }));
      emitter.on("tool_call_complete", (e) => events.push({ type: "tool_call_complete", ...e }));

      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([
        { type: "tool_call", name: "read_file", id: "toolu_123" },
        { type: "tool_call_complete", id: "toolu_123" },
      ]);
    });

    it("extracts text_delta events", async () => {
      const events = [];
      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello world"}}\n\n',
        );
        res.end();
      });

      emitter.on("text_delta", (e) => events.push(e));
      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([{ text: "Hello world" }]);
    });

    it("extracts usage from message_delta", async () => {
      const events = [];
      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":100,"output_tokens":50}}\n\n',
        );
        res.end();
      });

      emitter.on("usage", (e) => events.push(e));
      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([{ input_tokens: 100, output_tokens: 50 }]);
    });

    it("emits message_complete on message_stop", async () => {
      const events = [];
      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"message_stop"}\n\n');
        res.end();
      });

      emitter.on("message_complete", (e) => events.push(e));
      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([{}]);
    });

    it("extracts usage from message_start", async () => {
      const events = [];
      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          'data: {"type":"message_start","message":{"usage":{"input_tokens":200,"output_tokens":0}}}\n\n',
        );
        res.end();
      });

      emitter.on("usage", (e) => events.push(e));
      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([{ input_tokens: 200, output_tokens: 0 }]);
    });
  });

  describe("partial chunk handling", () => {
    it("handles SSE data split across multiple chunks", async () => {
      const events = [];
      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        // Split a single SSE event across two writes
        res.write('data: {"type":"content_block_start","index":0,');
        res.write('"content_block":{"type":"tool_use","id":"toolu_456","name":"bash"}}\n\n');
        res.write('data: {"type":"content_block_stop","index":0}\n\n');
        res.end();
      });

      emitter.on("tool_call", (e) => events.push({ type: "tool_call", ...e }));
      emitter.on("tool_call_complete", (e) => events.push({ type: "tool_call_complete", ...e }));

      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([
        { type: "tool_call", name: "bash", id: "toolu_456" },
        { type: "tool_call_complete", id: "toolu_456" },
      ]);
    });

    it("handles multiple SSE events in a single chunk", async () => {
      const events = [];
      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        // Two events in one write
        res.write(
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_789","name":"edit"}}\n\n' +
            'data: {"type":"content_block_stop","index":0}\n\n',
        );
        res.end();
      });

      emitter.on("tool_call", (e) => events.push({ type: "tool_call", ...e }));
      emitter.on("tool_call_complete", (e) => events.push({ type: "tool_call_complete", ...e }));

      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([
        { type: "tool_call", name: "edit", id: "toolu_789" },
        { type: "tool_call_complete", id: "toolu_789" },
      ]);
    });

    it("handles data split mid-line across chunks", async () => {
      const events = [];
      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        // Split in the middle of "data: " prefix
        res.write("da");
        res.write(
          'ta: {"type":"message_stop"}\n\n',
        );
        res.end();
      });

      emitter.on("message_complete", (e) => events.push(e));
      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([{}]);
    });
  });

  describe("non-streaming JSON", () => {
    it("extracts tool_use blocks and usage from JSON response", async () => {
      const events = [];
      const responseBody = JSON.stringify({
        content: [
          { type: "text", text: "Let me read that file." },
          { type: "tool_use", id: "toolu_abc", name: "read_file", input: { path: "/tmp/test" } },
        ],
        usage: { input_tokens: 150, output_tokens: 75 },
      });

      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(responseBody);
      });

      emitter.on("tool_call", (e) => events.push({ type: "tool_call", ...e }));
      emitter.on("tool_call_complete", (e) => events.push({ type: "tool_call_complete", ...e }));
      emitter.on("text_delta", (e) => events.push({ type: "text_delta", ...e }));
      emitter.on("usage", (e) => events.push({ type: "usage", ...e }));
      emitter.on("message_complete", (e) => events.push({ type: "message_complete" }));

      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([
        { type: "text_delta", text: "Let me read that file." },
        { type: "tool_call", name: "read_file", id: "toolu_abc" },
        { type: "tool_call_complete", id: "toolu_abc" },
        { type: "usage", input_tokens: 150, output_tokens: 75 },
        { type: "message_complete" },
      ]);
    });

    it("handles JSON response split across chunks", async () => {
      const events = [];
      const responseBody = JSON.stringify({
        content: [{ type: "text", text: "Hello" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        // Split JSON across two writes
        const mid = Math.floor(responseBody.length / 2);
        res.write(responseBody.slice(0, mid));
        res.end(responseBody.slice(mid));
      });

      emitter.on("text_delta", (e) => events.push({ type: "text_delta", ...e }));
      emitter.on("usage", (e) => events.push({ type: "usage", ...e }));
      emitter.on("message_complete", (e) => events.push({ type: "message_complete" }));

      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([
        { type: "text_delta", text: "Hello" },
        { type: "usage", input_tokens: 10, output_tokens: 5 },
        { type: "message_complete" },
      ]);
    });
  });

  describe("no response modification", () => {
    it("forwards SSE response unchanged to client", async () => {
      const ssePayload =
        'data: {"type":"message_stop"}\n\ndata: [DONE]\n\n';

      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(ssePayload);
      });

      // Just attach a listener so the interceptor runs
      emitter.on("message_complete", () => {});

      const response = await makeRequest(proxy.port, "{}");
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(ssePayload);
    });

    it("forwards JSON response unchanged to client", async () => {
      const jsonBody = JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 2 } });

      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(jsonBody);
      });

      emitter.on("usage", () => {});

      const response = await makeRequest(proxy.port, "{}");
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(jsonBody);
    });

    it("does not interfere with non-AI content types", async () => {
      const htmlBody = "<html><body>Hello</body></html>";

      await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(htmlBody);
      });

      const response = await makeRequest(proxy.port, "{}");
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(htmlBody);
    });
  });

  describe("createResponseInterceptor API", () => {
    it("creates its own emitter if none provided", () => {
      const { emitter, middleware } = createResponseInterceptor();
      expect(emitter).toBeInstanceOf(EventEmitter);
      expect(typeof middleware).toBe("function");
    });

    it("uses provided emitter", () => {
      const myEmitter = new EventEmitter();
      const { emitter } = createResponseInterceptor({ emitter: myEmitter });
      expect(emitter).toBe(myEmitter);
    });
  });

  describe("full SSE conversation flow", () => {
    it("handles a complete Anthropic SSE message with text + tool + usage", async () => {
      const events = [];
      const emitter = await setup((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const sseEvents = [
          'data: {"type":"message_start","message":{"usage":{"input_tokens":500,"output_tokens":0}}}',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I will read the file."}}',
          'data: {"type":"content_block_stop","index":0}',
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_full","name":"read_file"}}',
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\": \\"/tmp\\""}}',
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"}"}}',
          'data: {"type":"content_block_stop","index":1}',
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}',
          'data: {"type":"message_stop"}',
        ];
        res.end(sseEvents.join("\n\n") + "\n\n");
      });

      emitter.on("tool_call", (e) => events.push({ type: "tool_call", ...e }));
      emitter.on("tool_call_complete", (e) => events.push({ type: "tool_call_complete", ...e }));
      emitter.on("text_delta", (e) => events.push({ type: "text_delta", ...e }));
      emitter.on("usage", (e) => events.push({ type: "usage", ...e }));
      emitter.on("message_complete", (e) => events.push({ type: "message_complete" }));

      await makeRequest(proxy.port, "{}");

      expect(events).toEqual([
        { type: "usage", input_tokens: 500, output_tokens: 0 },
        { type: "text_delta", text: "I will read the file." },
        { type: "tool_call", name: "read_file", id: "toolu_full" },
        { type: "tool_call_complete", id: "toolu_full" },
        { type: "usage", output_tokens: 42 },
        { type: "message_complete" },
      ]);
    });
  });
});
