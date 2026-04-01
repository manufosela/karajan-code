import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { createProxyServer } from "../src/proxy/proxy-server.js";

/**
 * Helper: start a plain HTTP server that acts as a fake "upstream" API.
 * Returns {server, port, requests[]} — caller must close it.
 */
function createFakeUpstream(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, requests });
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

/** Helper: collect raw chunks from an HTTP response (for streaming tests). */
function httpRequestStreaming(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c.toString()));
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, chunks });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("proxy-server", () => {
  let proxy;
  let upstream;

  afterEach(async () => {
    if (proxy) await proxy.close();
    if (upstream) upstream.server.close();
    proxy = null;
    upstream = null;
  });

  // ─── Provider detection ──────────────────────────────────────────────
  describe("provider detection", () => {
    it("detects anthropic from Host header", async () => {
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });

      let detectedProvider;
      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        // Override target so it hits our local upstream instead of real API
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      proxy.use(async (ctx, next) => {
        detectedProvider = ctx.provider;
        await next();
      });
      await proxy.listen();

      await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/v1/messages",
        method: "POST",
        headers: { host: "api.anthropic.com", "content-type": "application/json" },
      }, '{"model":"claude"}');

      expect(detectedProvider).toBe("anthropic");
    });

    it("detects openai from Host header", async () => {
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });

      let detectedProvider;
      proxy = createProxyServer({
        port: 0,
        targetHosts: {
          "api.openai.com": "openai",
          "api.anthropic.com": "anthropic",
        },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      proxy.use(async (ctx, next) => {
        detectedProvider = ctx.provider;
        await next();
      });
      await proxy.listen();

      await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { host: "api.openai.com" },
      });

      expect(detectedProvider).toBe("openai");
    });

    it("detects gemini from Host header", async () => {
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });

      let detectedProvider;
      proxy = createProxyServer({
        port: 0,
        targetHosts: {
          "generativelanguage.googleapis.com": "gemini",
        },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      proxy.use(async (ctx, next) => {
        detectedProvider = ctx.provider;
        await next();
      });
      await proxy.listen();

      await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/v1/models",
        method: "GET",
        headers: { host: "generativelanguage.googleapis.com" },
      });

      expect(detectedProvider).toBe("gemini");
    });

    it("sets provider to 'unknown' for unrecognized hosts", async () => {
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });

      let detectedProvider;
      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      proxy.use(async (ctx, next) => {
        detectedProvider = ctx.provider;
        await next();
      });
      await proxy.listen();

      await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/test",
        method: "GET",
        headers: { host: "api.unknown.com" },
      });

      expect(detectedProvider).toBe("unknown");
    });
  });

  // ─── Basic forwarding ────────────────────────────────────────────────
  describe("basic forwarding", () => {
    it("forwards request and returns upstream response", async () => {
      upstream = await createFakeUpstream((_req, res, body) => {
        const parsed = JSON.parse(body);
        res.writeHead(200, { "content-type": "application/json", "x-custom": "test" });
        res.end(JSON.stringify({ echo: parsed.msg }));
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      await proxy.listen();

      const resp = await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/v1/messages",
        method: "POST",
        headers: {
          host: "api.anthropic.com",
          "content-type": "application/json",
        },
      }, JSON.stringify({ msg: "hello" }));

      expect(resp.statusCode).toBe(200);
      expect(JSON.parse(resp.body)).toEqual({ echo: "hello" });
      expect(resp.headers["x-custom"]).toBe("test");
    });

    it("forwards request headers to upstream", async () => {
      upstream = await createFakeUpstream((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ auth: req.headers["authorization"] }));
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      await proxy.listen();

      const resp = await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/v1/messages",
        method: "POST",
        headers: {
          host: "api.anthropic.com",
          authorization: "Bearer sk-test-123",
        },
      }, "{}");

      expect(JSON.parse(resp.body).auth).toBe("Bearer sk-test-123");
    });
  });

  // ─── Middleware chain ────────────────────────────────────────────────
  describe("middleware chain", () => {
    it("executes middleware in order with before/after semantics", async () => {
      const order = [];

      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });

      proxy.use(async (_ctx, next) => {
        order.push("mw1-before");
        await next();
        order.push("mw1-after");
      });
      proxy.use(async (_ctx, next) => {
        order.push("mw2-before");
        await next();
        order.push("mw2-after");
      });

      await proxy.listen();

      await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/test",
        method: "GET",
        headers: { host: "api.anthropic.com" },
      });

      expect(order).toEqual(["mw1-before", "mw2-before", "mw2-after", "mw1-after"]);
    });

    it("allows middleware to modify the request body", async () => {
      upstream = await createFakeUpstream((_req, res, body) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });

      proxy.use(async (ctx, next) => {
        // Modify the body before forwarding
        const parsed = JSON.parse(ctx.body);
        parsed.injected = true;
        ctx.modifiedBody = JSON.stringify(parsed);
        await next();
      });

      await proxy.listen();

      const resp = await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/echo",
        method: "POST",
        headers: { host: "api.anthropic.com", "content-type": "application/json" },
      }, JSON.stringify({ original: true }));

      const result = JSON.parse(resp.body);
      expect(result.original).toBe(true);
      expect(result.injected).toBe(true);
    });

    it("provides ctx.req, ctx.res, ctx.body, ctx.provider", async () => {
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });

      let capturedCtx;
      proxy.use(async (ctx, next) => {
        capturedCtx = { ...ctx };
        await next();
      });

      await proxy.listen();

      await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/test",
        method: "POST",
        headers: { host: "api.anthropic.com" },
      }, "test-body");

      expect(capturedCtx.req).toBeDefined();
      expect(capturedCtx.res).toBeDefined();
      expect(capturedCtx.body).toBe("test-body");
      expect(capturedCtx.provider).toBe("anthropic");
    });
  });

  // ─── Health check ────────────────────────────────────────────────────
  describe("health check", () => {
    it("returns 200 with JSON status at /_kj/health", async () => {
      proxy = createProxyServer({
        port: 0,
        targetHosts: {},
      });
      await proxy.listen();

      const resp = await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/_kj/health",
        method: "GET",
      });

      expect(resp.statusCode).toBe(200);
      const data = JSON.parse(resp.body);
      expect(data.status).toBe("ok");
      expect(typeof data.uptime).toBe("number");
      expect(typeof data.requests).toBe("number");
      expect(data.requests).toBe(0); // health check doesn't count
    });

    it("reflects request count after proxied requests", async () => {
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      await proxy.listen();

      // Make 3 proxied requests
      for (let i = 0; i < 3; i++) {
        await httpRequest({
          hostname: "127.0.0.1",
          port: proxy.port,
          path: "/v1/messages",
          method: "POST",
          headers: { host: "api.anthropic.com" },
        }, "{}");
      }

      const resp = await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/_kj/health",
        method: "GET",
      });

      const data = JSON.parse(resp.body);
      expect(data.requests).toBe(3);
    });
  });

  // ─── Stats ───────────────────────────────────────────────────────────
  describe("stats", () => {
    it("tracks bytes_in and bytes_out", async () => {
      const responseBody = JSON.stringify({ result: "hello world" });
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(responseBody);
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      await proxy.listen();

      const requestBody = JSON.stringify({ msg: "test" });
      await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/v1/messages",
        method: "POST",
        headers: { host: "api.anthropic.com", "content-type": "application/json" },
      }, requestBody);

      const stats = proxy.stats;
      expect(stats.requests).toBe(1);
      expect(stats.bytes_in).toBe(Buffer.byteLength(requestBody));
      expect(stats.bytes_out).toBe(Buffer.byteLength(responseBody));
    });
  });

  // ─── Error handling (502) ────────────────────────────────────────────
  describe("error handling", () => {
    it("returns 502 when upstream is unreachable", async () => {
      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        // Point to a port that nothing listens on
        _testTarget: { hostname: "127.0.0.1", port: 1, protocol: "http:" },
      });
      await proxy.listen();

      const resp = await httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/v1/messages",
        method: "POST",
        headers: { host: "api.anthropic.com" },
      }, "{}");

      expect(resp.statusCode).toBe(502);
      const data = JSON.parse(resp.body);
      expect(data.error).toBeDefined();
      expect(data.error).toMatch(/bad.gateway/i);
    });
  });

  // ─── Streaming / SSE passthrough ─────────────────────────────────────
  describe("streaming passthrough", () => {
    it("preserves SSE streaming without buffering", async () => {
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        // Send SSE events with delays
        res.write("data: chunk1\n\n");
        setTimeout(() => {
          res.write("data: chunk2\n\n");
          setTimeout(() => {
            res.write("data: [DONE]\n\n");
            res.end();
          }, 30);
        }, 30);
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      await proxy.listen();

      const result = await httpRequestStreaming({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/v1/messages",
        method: "POST",
        headers: { host: "api.anthropic.com" },
      }, "{}");

      expect(result.statusCode).toBe(200);
      expect(result.headers["content-type"]).toBe("text/event-stream");
      const combined = result.chunks.join("");
      expect(combined).toContain("data: chunk1");
      expect(combined).toContain("data: chunk2");
      expect(combined).toContain("data: [DONE]");
    });

    it("preserves chunked transfer encoding", async () => {
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200, { "content-type": "application/json", "transfer-encoding": "chunked" });
        res.write('{"partial":');
        setTimeout(() => {
          res.write('"value"}');
          res.end();
        }, 30);
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.openai.com": "openai" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      await proxy.listen();

      const result = await httpRequestStreaming({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { host: "api.openai.com" },
      }, "{}");

      expect(result.statusCode).toBe(200);
      const combined = result.chunks.join("");
      expect(combined).toBe('{"partial":"value"}');
    });
  });

  // ─── Graceful shutdown ───────────────────────────────────────────────
  describe("graceful shutdown", () => {
    it("close() resolves a promise", async () => {
      proxy = createProxyServer({ port: 0, targetHosts: {} });
      await proxy.listen();

      const result = await proxy.close();
      expect(result).toBeUndefined(); // resolves cleanly
      proxy = null; // prevent afterEach from double-closing
    });

    it("close() drains active connections before resolving", async () => {
      let finishResponse;
      upstream = await createFakeUpstream((_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        // Hold the response open — we'll finish it after calling close()
        finishResponse = () => res.end("done");
      });

      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstream.port, protocol: "http:" },
      });
      await proxy.listen();

      // Start a request that won't finish immediately
      const reqPromise = httpRequest({
        hostname: "127.0.0.1",
        port: proxy.port,
        path: "/slow",
        method: "GET",
        headers: { host: "api.anthropic.com" },
      });

      // Wait a tick for the request to be in-flight
      await new Promise((r) => setTimeout(r, 50));

      // Start closing — should not resolve until the request finishes
      let closed = false;
      const closePromise = proxy.close().then(() => { closed = true; });

      // Give close a moment
      await new Promise((r) => setTimeout(r, 50));
      expect(closed).toBe(false); // still waiting for active request

      // Now finish the response
      finishResponse();
      await reqPromise;
      await closePromise;
      expect(closed).toBe(true);
      proxy = null;
    });
  });
});
