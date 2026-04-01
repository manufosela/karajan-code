import http from "node:http";
import https from "node:https";

/**
 * Create a lightweight HTTP forward proxy with middleware pipeline.
 *
 * The proxy receives plain HTTP on localhost, detects the AI provider from the
 * Host header, runs the middleware chain, then forwards the request as HTTPS
 * (or HTTP for testing) to the real API endpoint.
 *
 * @param {object} options
 * @param {number} options.port - Port to listen on (0 = OS-assigned)
 * @param {Record<string, string>} options.targetHosts - Map host → provider name
 * @param {object} [options._testTarget] - Override target for testing (hostname, port, protocol)
 * @returns {ProxyServer}
 */
export function createProxyServer({ port = 0, targetHosts = {}, _testTarget } = {}) {
  const middlewares = [];
  const startTime = Date.now();
  const stats = { requests: 0, bytes_in: 0, bytes_out: 0 };
  let activeConnections = 0;
  let closing = false;
  let closeResolve = null;

  function detectProvider(host) {
    // Strip port from host if present
    const hostname = (host || "").split(":")[0];
    return targetHosts[hostname] || "unknown";
  }

  /**
   * Compose middlewares into a single function using Koa-style next() chaining.
   */
  function compose(mws, finalHandler) {
    return function run(ctx) {
      let index = -1;
      function dispatch(i) {
        if (i <= index) return Promise.reject(new Error("next() called multiple times"));
        index = i;
        const fn = i < mws.length ? mws[i] : finalHandler;
        if (!fn) return Promise.resolve();
        return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
      }
      return dispatch(0);
    };
  }

  /**
   * Forward the request to the upstream target and stream the response back.
   */
  function forwardRequest(ctx) {
    return new Promise((resolve, reject) => {
      const { req, res } = ctx;
      const host = (req.headers.host || "").split(":")[0];
      const body = ctx.modifiedBody != null ? ctx.modifiedBody : ctx.body;

      // Determine target
      let targetHostname, targetPort, useHttps;
      if (_testTarget) {
        targetHostname = _testTarget.hostname;
        targetPort = _testTarget.port;
        useHttps = _testTarget.protocol === "https:";
      } else {
        targetHostname = host;
        targetPort = 443;
        useHttps = true;
      }

      const transport = useHttps ? https : http;

      // Clone headers, remove hop-by-hop headers, update content-length
      const headers = { ...req.headers };
      delete headers["transfer-encoding"];
      delete headers["connection"];
      delete headers["proxy-connection"];
      delete headers["keep-alive"];
      if (body != null) {
        headers["content-length"] = String(Buffer.byteLength(body));
      }

      const proxyReq = transport.request(
        {
          hostname: targetHostname,
          port: targetPort,
          path: req.url,
          method: req.method,
          headers,
        },
        (proxyRes) => {
          // Track bytes out by instrumenting the response
          proxyRes.on("data", (chunk) => {
            stats.bytes_out += chunk.length;
          });

          // Stream the response back — write head then pipe
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
          proxyRes.on("end", resolve);
          proxyRes.on("error", reject);
        },
      );

      proxyReq.on("error", (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Bad Gateway", message: err.message }));
        }
        resolve(); // Don't reject — we handled the error via 502
      });

      if (body) {
        proxyReq.write(body);
      }
      proxyReq.end();
    });
  }

  function handleRequest(req, res) {
    // Health check — bypass middleware and proxy
    if (req.url === "/_kj/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          uptime: Math.round((Date.now() - startTime) / 1000),
          requests: stats.requests,
        }),
      );
      return;
    }

    activeConnections++;
    stats.requests++;

    // Collect body
    const chunks = [];
    req.on("data", (c) => {
      chunks.push(c);
      stats.bytes_in += c.length;
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      const provider = detectProvider(req.headers.host);

      const ctx = {
        req,
        res,
        body,
        provider,
        modifiedBody: null,
      };

      const chain = compose(middlewares, (c) => forwardRequest(c));
      chain(ctx)
        .catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
          }
        })
        .finally(() => {
          activeConnections--;
          if (closing && activeConnections === 0 && closeResolve) {
            closeResolve();
          }
        });
    });
  }

  const server = http.createServer(handleRequest);

  const instance = {
    get port() {
      const addr = server.address();
      return addr ? addr.port : port;
    },

    get stats() {
      return { ...stats };
    },

    /**
     * Register a middleware function.
     * @param {(ctx: object, next: () => Promise<void>) => Promise<void>} fn
     */
    use(fn) {
      middlewares.push(fn);
      return instance;
    },

    /**
     * Start listening on the configured port.
     * @returns {Promise<void>}
     */
    listen() {
      return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
      });
    },

    /**
     * Graceful shutdown — stop accepting new connections,
     * drain active ones, then resolve.
     * @returns {Promise<void>}
     */
    close() {
      closing = true;
      return new Promise((resolve) => {
        server.close(() => {
          if (activeConnections === 0) {
            resolve();
          } else {
            closeResolve = resolve;
          }
        });
      });
    },
  };

  return instance;
}
