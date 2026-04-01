import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import {
  startProxy,
  stopProxy,
  getProxyEnv,
  isProxyRunning,
} from "../src/proxy/proxy-lifecycle.js";

afterEach(async () => {
  await stopProxy();
});

describe("proxy-lifecycle", () => {
  describe("startProxy", () => {
    it("starts the proxy and returns port + baseUrls", async () => {
      const result = await startProxy();

      expect(result.port).toBeGreaterThan(0);
      expect(result.baseUrls).toEqual({
        anthropic: `http://127.0.0.1:${result.port}`,
        openai: `http://127.0.0.1:${result.port}`,
        gemini: `http://127.0.0.1:${result.port}`,
      });
    });

    it("returns same info if called twice (idempotent)", async () => {
      const first = await startProxy();
      const second = await startProxy();

      expect(second.port).toBe(first.port);
    });

    it("health endpoint responds after start", async () => {
      const { port } = await startProxy();

      const body = await httpGet(`http://127.0.0.1:${port}/_kj/health`);
      const json = JSON.parse(body);

      expect(json.status).toBe("ok");
      expect(json).toHaveProperty("uptime");
      expect(json).toHaveProperty("requests");
    });

    it("accepts custom targetHosts via config", async () => {
      const result = await startProxy({
        config: { targetHosts: { "custom.api.com": "custom" } },
      });

      expect(result.port).toBeGreaterThan(0);
    });
  });

  describe("stopProxy", () => {
    it("stops a running proxy", async () => {
      const { port } = await startProxy();

      await stopProxy();

      // Server should no longer respond
      const alive = await canConnect(port);
      expect(alive).toBe(false);
    });

    it("is safe to call when no proxy is running", async () => {
      // Should not throw
      await stopProxy();
      await stopProxy();
    });

    it("allows starting a new proxy after stop", async () => {
      const first = await startProxy();
      await stopProxy();

      const second = await startProxy();
      expect(second.port).toBeGreaterThan(0);
      // Port may differ since the old one was freed
    });
  });

  describe("getProxyEnv", () => {
    it("returns null when proxy is not running", () => {
      const env = getProxyEnv();
      expect(env).toBeNull();
    });

    it("returns env vars with correct base URL when running", async () => {
      const { port } = await startProxy();
      const env = getProxyEnv();

      expect(env).toEqual({
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        OPENAI_BASE_URL: `http://127.0.0.1:${port}`,
        GEMINI_API_BASE: `http://127.0.0.1:${port}`,
      });
    });

    it("returns null after proxy is stopped", async () => {
      await startProxy();
      await stopProxy();

      const env = getProxyEnv();
      expect(env).toBeNull();
    });
  });

  describe("isProxyRunning", () => {
    it("returns false when proxy is not started", async () => {
      const running = await isProxyRunning();
      expect(running).toBe(false);
    });

    it("returns true when proxy is running", async () => {
      await startProxy();
      const running = await isProxyRunning();
      expect(running).toBe(true);
    });

    it("returns false after proxy is stopped", async () => {
      await startProxy();
      await stopProxy();

      const running = await isProxyRunning();
      expect(running).toBe(false);
    });
  });
});

// --- Helpers ---

/** Simple HTTP GET that resolves to the response body string. */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString()));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/** Check if we can connect to a port (true = something listening). */
function canConnect(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/_kj/health`, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}
