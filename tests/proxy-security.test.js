import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { sanitizeHeaders, isRequestTooLarge } from "../src/proxy/security.js";
import { createProxyServer } from "../src/proxy/proxy-server.js";

// ─── sanitizeHeaders ────────────────────────────────────────────────

describe("sanitizeHeaders", () => {
  it("redacts Authorization header", () => {
    const result = sanitizeHeaders({ Authorization: "Bearer sk-secret123", "content-type": "application/json" });
    expect(result.Authorization).toBe("[REDACTED]");
    expect(result["content-type"]).toBe("application/json");
  });

  it("redacts x-api-key header (case-insensitive key)", () => {
    const result = sanitizeHeaders({ "x-api-key": "my-secret-key" });
    expect(result["x-api-key"]).toBe("[REDACTED]");
  });

  it("redacts x-goog-api-key header", () => {
    const result = sanitizeHeaders({ "x-goog-api-key": "AIza-secret" });
    expect(result["x-goog-api-key"]).toBe("[REDACTED]");
  });

  it("redacts multiple sensitive headers at once", () => {
    const result = sanitizeHeaders({
      authorization: "Bearer token",
      "x-api-key": "key1",
      "x-goog-api-key": "key2",
      host: "api.example.com",
    });
    expect(result.authorization).toBe("[REDACTED]");
    expect(result["x-api-key"]).toBe("[REDACTED]");
    expect(result["x-goog-api-key"]).toBe("[REDACTED]");
    expect(result.host).toBe("api.example.com");
  });

  it("does not modify the original headers object", () => {
    const original = { authorization: "Bearer token", host: "example.com" };
    const result = sanitizeHeaders(original);
    expect(original.authorization).toBe("Bearer token");
    expect(result.authorization).toBe("[REDACTED]");
  });

  it("returns empty object for null/undefined input", () => {
    expect(sanitizeHeaders(null)).toEqual({});
    expect(sanitizeHeaders(undefined)).toEqual({});
  });

  it("preserves non-sensitive headers unchanged", () => {
    const headers = { "content-type": "application/json", accept: "*/*", "user-agent": "test" };
    const result = sanitizeHeaders(headers);
    expect(result).toEqual(headers);
  });
});

// ─── isRequestTooLarge ──────────────────────────────────────────────

describe("isRequestTooLarge", () => {
  const FIFTY_MB = 50 * 1024 * 1024;

  it("returns false when content-length is under the limit", () => {
    expect(isRequestTooLarge(1024, FIFTY_MB)).toBe(false);
  });

  it("returns false when content-length equals the limit", () => {
    expect(isRequestTooLarge(FIFTY_MB, FIFTY_MB)).toBe(false);
  });

  it("returns true when content-length exceeds the limit", () => {
    expect(isRequestTooLarge(FIFTY_MB + 1, FIFTY_MB)).toBe(true);
  });

  it("handles string content-length", () => {
    expect(isRequestTooLarge("999", 500)).toBe(true);
    expect(isRequestTooLarge("100", 500)).toBe(false);
  });

  it("returns false for null/undefined content-length", () => {
    expect(isRequestTooLarge(null)).toBe(false);
    expect(isRequestTooLarge(undefined)).toBe(false);
  });

  it("returns false for NaN content-length", () => {
    expect(isRequestTooLarge("not-a-number")).toBe(false);
  });

  it("uses 50 MB as default maxBytes", () => {
    expect(isRequestTooLarge(FIFTY_MB)).toBe(false);
    expect(isRequestTooLarge(FIFTY_MB + 1)).toBe(true);
  });
});

// ─── proxy-server body size enforcement ─────────────────────────────

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

describe("proxy-server body size limit", () => {
  let proxy;

  afterEach(async () => {
    if (proxy) await proxy.close();
  });

  it("returns 413 when Content-Length exceeds 50 MB", async () => {
    proxy = createProxyServer({ port: 0, targetHosts: {} });
    await proxy.listen();

    const res = await httpRequest({
      hostname: "127.0.0.1",
      port: proxy.port,
      method: "POST",
      path: "/v1/chat",
      headers: {
        host: "api.anthropic.com",
        "content-length": String(60 * 1024 * 1024), // 60 MB
      },
    });

    expect(res.statusCode).toBe(413);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe("Payload Too Large");
  });

  it("accepts requests under the size limit", async () => {
    // Create a fake upstream to receive the forwarded request
    const upstream = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      });
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = upstream.address().port;

    try {
      proxy = createProxyServer({
        port: 0,
        targetHosts: { "api.anthropic.com": "anthropic" },
        _testTarget: { hostname: "127.0.0.1", port: upstreamPort, protocol: "http:" },
      });
      await proxy.listen();

      const smallBody = "hello";
      const res = await httpRequest(
        {
          hostname: "127.0.0.1",
          port: proxy.port,
          method: "POST",
          path: "/v1/chat",
          headers: {
            host: "api.anthropic.com",
            "content-length": String(Buffer.byteLength(smallBody)),
          },
        },
        smallBody,
      );

      expect(res.statusCode).toBe(200);
    } finally {
      upstream.close();
    }
  });
});
