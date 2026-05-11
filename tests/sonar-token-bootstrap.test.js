import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn(),
}));

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

let tmpHome;

beforeEach(async () => {
  vi.resetAllMocks();
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sonar-token-"));
  const { getKarajanHome } = await import("../src/utils/paths.js");
  getKarajanHome.mockReturnValue(tmpHome);
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function jsonResponse(status, body) {
  return Promise.resolve({
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  });
}

describe("bootstrapSonarToken (KJC-TSK-0367)", () => {
  it("returns ok with token + persists when admin/admin works and password rotates", async () => {
    fetchMock
      // 1. validate admin/admin → 200 valid
      .mockReturnValueOnce(jsonResponse(200, { valid: true }))
      // 2. change_password → 204 (password rotated)
      .mockReturnValueOnce(jsonResponse(204, ""))
      // 3. token revoke (idempotent attempt) → 200 or 404, doesn't matter
      .mockReturnValueOnce(jsonResponse(200, ""))
      // 4. generate token → 200 with token
      .mockReturnValueOnce(jsonResponse(200, { token: "squ_aabbccdd11223344" }));

    const { bootstrapSonarToken } = await import("../src/sonar/token-bootstrap.js");
    const r = await bootstrapSonarToken({ host: "http://localhost:9000" });

    expect(r.ok).toBe(true);
    expect(r.token).toBe("squ_aabbccdd11223344");
    expect(r.passwordRotated).toBe(true);
    expect(fs.readFileSync(r.savedTo, "utf8")).toBe("squ_aabbccdd11223344");
    expect(fs.readFileSync(r.passwordSavedTo, "utf8").length).toBeGreaterThan(0);
    if (process.platform !== "win32") {
      const mode = fs.statSync(r.savedTo).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("returns ok=false when admin/admin login fails (password already customized)", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(401, { errors: [{ msg: "no" }] }));

    const { bootstrapSonarToken } = await import("../src/sonar/token-bootstrap.js");
    const r = await bootstrapSonarToken({ host: "http://localhost:9000" });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/admin\/admin login failed/);
  });

  it("returns ok=false on network error reaching the host", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { bootstrapSonarToken } = await import("../src/sonar/token-bootstrap.js");
    const r = await bootstrapSonarToken({ host: "http://localhost:9000" });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/network error/i);
  });

  it("succeeds when password rotation is rejected because the admin already changed it", async () => {
    // probe ok, change_password 401 (admin already changed), revoke ok, generate ok
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, { valid: true }))
      .mockReturnValueOnce(jsonResponse(401, { errors: [{ msg: "incorrect previous password" }] }))
      .mockReturnValueOnce(jsonResponse(200, ""))
      .mockReturnValueOnce(jsonResponse(200, { token: "squ_kept_password" }));

    const { bootstrapSonarToken } = await import("../src/sonar/token-bootstrap.js");
    const r = await bootstrapSonarToken({ host: "http://localhost:9000" });

    // We continue with whatever creds worked at probe; here change failed
    // so we use the original admin/admin to call generate. The mock
    // returns a token, so end-to-end should still succeed.
    expect(r.ok).toBe(true);
    expect(r.token).toBe("squ_kept_password");
    expect(r.passwordRotated).toBe(false);
    // 401 = "admin already changed it" → not an error, no rotation diagnostic
    expect(r.passwordRotationError).toBe(null);
  });

  // KJC-BUG-0035: rotation must NOT fail silently on unexpected statuses.
  // Pre-fix the bootstrapper swallowed 403/500/etc., leaving admin/admin
  // live on disk while pretending everything worked.
  it("surfaces passwordRotationError on HTTP 403 rotation (no permission)", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, { valid: true }))
      .mockReturnValueOnce(jsonResponse(403, { errors: [{ msg: "Forbidden" }] }))
      .mockReturnValueOnce(jsonResponse(200, ""))
      .mockReturnValueOnce(jsonResponse(200, { token: "squ_kept_403" }));

    const { bootstrapSonarToken } = await import("../src/sonar/token-bootstrap.js");
    const r = await bootstrapSonarToken({ host: "http://localhost:9000" });

    expect(r.ok).toBe(true);
    expect(r.passwordRotated).toBe(false);
    expect(r.passwordRotationError).toMatch(/HTTP 403/);
    expect(r.passwordRotationError).toMatch(/Forbidden/);
  });

  it("surfaces passwordRotationError on HTTP 500 rotation (server error)", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, { valid: true }))
      .mockReturnValueOnce(jsonResponse(500, { errors: [{ msg: "Internal error" }] }))
      .mockReturnValueOnce(jsonResponse(200, ""))
      .mockReturnValueOnce(jsonResponse(200, { token: "squ_kept_500" }));

    const { bootstrapSonarToken } = await import("../src/sonar/token-bootstrap.js");
    const r = await bootstrapSonarToken({ host: "http://localhost:9000" });

    expect(r.ok).toBe(true);
    expect(r.passwordRotated).toBe(false);
    expect(r.passwordRotationError).toMatch(/HTTP 500/);
  });

  it("surfaces passwordRotationError on 400-without-default-error (validation mismatch)", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, { valid: true }))
      .mockReturnValueOnce(jsonResponse(400, { errors: [{ msg: "Password too short" }] }))
      .mockReturnValueOnce(jsonResponse(200, ""))
      .mockReturnValueOnce(jsonResponse(200, { token: "squ_kept_400" }));

    const { bootstrapSonarToken } = await import("../src/sonar/token-bootstrap.js");
    const r = await bootstrapSonarToken({ host: "http://localhost:9000" });

    expect(r.ok).toBe(true);
    expect(r.passwordRotated).toBe(false);
    expect(r.passwordRotationError).toMatch(/HTTP 400/);
  });

  it("returns ok=false with reason when token generation itself fails", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, { valid: true }))
      .mockReturnValueOnce(jsonResponse(204, ""))
      .mockReturnValueOnce(jsonResponse(200, ""))
      // Generate fails
      .mockReturnValueOnce(jsonResponse(403, { errors: [{ msg: "Insufficient privileges" }] }));

    const { bootstrapSonarToken } = await import("../src/sonar/token-bootstrap.js");
    const r = await bootstrapSonarToken({ host: "http://localhost:9000" });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Insufficient privileges|token generation failed/);
  });
});
