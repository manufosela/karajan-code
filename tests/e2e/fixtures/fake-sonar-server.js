/**
 * Fake SonarQube HTTP server for e2e tests.
 *
 * Spins up a tiny http server bound to a random port and serves canned
 * responses for the SonarQube REST endpoints that Karajan calls during
 * a quality-gate check. The test reads `server.port` and exports
 * `KJ_SONAR_HOST=http://127.0.0.1:<port>`.
 *
 * Two response modes:
 *   - "ok"           — quality_gate.status = OK, no issues
 *   - "config-error" — quality_gate returns the "Invalid value of
 *     sonar.tests" failure that the Repairer regression covers.
 *
 * Usage:
 *   import { startFakeSonar } from "./fixtures/fake-sonar-server.js";
 *   const sonar = await startFakeSonar({ mode: "ok" });
 *   try {
 *     // ... runKj([...], { env: { KJ_SONAR_HOST: sonar.url } })
 *   } finally { await sonar.stop(); }
 */

import http from "node:http";

function buildResponse(mode, url) {
  // Match by pathname; the most-called endpoint Karajan hits is
  // /api/qualitygates/project_status?projectKey=...
  if (url.pathname.includes("/api/qualitygates/project_status")) {
    if (mode === "config-error") {
      return {
        status: 400,
        body: JSON.stringify({
          errors: [
            { msg: "Invalid value of sonar.tests" }
          ]
        })
      };
    }
    return {
      status: 200,
      body: JSON.stringify({
        projectStatus: {
          status: mode === "fail" ? "ERROR" : "OK",
          conditions: []
        }
      })
    };
  }
  if (url.pathname.includes("/api/issues/search")) {
    return {
      status: 200,
      body: JSON.stringify({ total: 0, issues: [] })
    };
  }
  if (url.pathname.includes("/api/server/version")) {
    return { status: 200, body: "10.5.0" };
  }
  if (url.pathname.includes("/api/system/status")) {
    return {
      status: 200,
      body: JSON.stringify({ status: "UP" })
    };
  }
  // Generic 200 OK so unknown probes don't 500-and-fail-CI.
  return { status: 200, body: "{}" };
}

export async function startFakeSonar({ mode = "ok", host = "127.0.0.1" } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}`);
    const { status, body } = buildResponse(mode, url);
    res.statusCode = status;
    res.setHeader("Content-Type", body.startsWith("{") || body.startsWith("[") ? "application/json" : "text/plain");
    res.end(body);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });

  const port = server.address().port;
  const url = `http://${host}:${port}`;
  return {
    server,
    port,
    url,
    async stop() {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
