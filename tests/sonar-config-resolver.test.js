import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock credentials.js before importing the module under test
vi.mock("../src/sonar/credentials.js", () => ({
  loadSonarCredentials: vi.fn().mockResolvedValue({ user: null, password: null }),
}));

import {
  resolveSonarHost,
  resolveSonarToken,
  resolveSonarCredentials,
} from "../src/sonar/config-resolver.js";
import { loadSonarCredentials } from "../src/sonar/credentials.js";

describe("resolveSonarHost", () => {
  it("returns default host when no input", () => {
    expect(resolveSonarHost()).toBe("http://localhost:9000");
    expect(resolveSonarHost(undefined)).toBe("http://localhost:9000");
    expect(resolveSonarHost("")).toBe("http://localhost:9000");
  });

  it("replaces host.docker.internal with localhost", () => {
    expect(resolveSonarHost("http://host.docker.internal:9000")).toBe("http://localhost:9000");
  });

  it("strips trailing slashes", () => {
    expect(resolveSonarHost("http://localhost:9000/")).toBe("http://localhost:9000");
    expect(resolveSonarHost("http://localhost:9000///")).toBe("http://localhost:9000");
  });

  it("preserves external hosts", () => {
    expect(resolveSonarHost("https://sonar.example.com")).toBe("https://sonar.example.com");
  });
});

describe("resolveSonarToken", () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.KJ_SONAR_TOKEN = process.env.KJ_SONAR_TOKEN;
    savedEnv.SONAR_TOKEN = process.env.SONAR_TOKEN;
    delete process.env.KJ_SONAR_TOKEN;
    delete process.env.SONAR_TOKEN;
  });

  afterEach(() => {
    if (savedEnv.KJ_SONAR_TOKEN !== undefined) process.env.KJ_SONAR_TOKEN = savedEnv.KJ_SONAR_TOKEN;
    else delete process.env.KJ_SONAR_TOKEN;
    if (savedEnv.SONAR_TOKEN !== undefined) process.env.SONAR_TOKEN = savedEnv.SONAR_TOKEN;
    else delete process.env.SONAR_TOKEN;
  });

  it("returns KJ_SONAR_TOKEN env var with highest priority", () => {
    process.env.KJ_SONAR_TOKEN = "env-kj-token";
    process.env.SONAR_TOKEN = "env-sonar-token";
    const config = { sonarqube: { token: "config-token" } };
    expect(resolveSonarToken(config)).toBe("env-kj-token");
  });

  it("returns config sonarqube.token as second priority", () => {
    process.env.SONAR_TOKEN = "env-sonar-token";
    const config = { sonarqube: { token: "config-token" } };
    expect(resolveSonarToken(config)).toBe("config-token");
  });

  it("returns SONAR_TOKEN env var as third priority", () => {
    process.env.SONAR_TOKEN = "env-sonar-token";
    expect(resolveSonarToken({})).toBe("env-sonar-token");
  });

  it("returns null when no token available", () => {
    expect(resolveSonarToken({})).toBeNull();
    expect(resolveSonarToken()).toBeNull();
  });
});

describe("resolveSonarCredentials", () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.KJ_SONAR_ADMIN_USER = process.env.KJ_SONAR_ADMIN_USER;
    savedEnv.KJ_SONAR_ADMIN_PASSWORD = process.env.KJ_SONAR_ADMIN_PASSWORD;
    delete process.env.KJ_SONAR_ADMIN_USER;
    delete process.env.KJ_SONAR_ADMIN_PASSWORD;
    loadSonarCredentials.mockResolvedValue({ user: null, password: null });
  });

  afterEach(() => {
    if (savedEnv.KJ_SONAR_ADMIN_USER !== undefined) process.env.KJ_SONAR_ADMIN_USER = savedEnv.KJ_SONAR_ADMIN_USER;
    else delete process.env.KJ_SONAR_ADMIN_USER;
    if (savedEnv.KJ_SONAR_ADMIN_PASSWORD !== undefined) process.env.KJ_SONAR_ADMIN_PASSWORD = savedEnv.KJ_SONAR_ADMIN_PASSWORD;
    else delete process.env.KJ_SONAR_ADMIN_PASSWORD;
  });

  it("resolves user and password from env vars", async () => {
    process.env.KJ_SONAR_ADMIN_USER = "env-user";
    process.env.KJ_SONAR_ADMIN_PASSWORD = "env-pass";
    const result = await resolveSonarCredentials({});
    expect(result.user).toBe("env-user");
    expect(result.passwords).toEqual(["env-pass", "admin"]);
  });

  it("resolves from config as second priority", async () => {
    const config = { sonarqube: { admin_user: "cfg-user", admin_password: "cfg-pass" } };
    const result = await resolveSonarCredentials(config);
    expect(result.user).toBe("cfg-user");
    expect(result.passwords).toEqual(["cfg-pass", "admin"]);
  });

  it("resolves from credentials file as last priority", async () => {
    loadSonarCredentials.mockResolvedValue({ user: "file-user", password: "file-pass" });
    const result = await resolveSonarCredentials({});
    expect(result.user).toBe("file-user");
    expect(result.passwords).toEqual(["file-pass", "admin"]);
  });

  it("deduplicates passwords across sources including default admin", async () => {
    process.env.KJ_SONAR_ADMIN_PASSWORD = "same-pass";
    const config = { sonarqube: { admin_password: "same-pass" } };
    loadSonarCredentials.mockResolvedValue({ user: null, password: "same-pass" });
    const result = await resolveSonarCredentials(config);
    expect(result.passwords).toEqual(["same-pass", "admin"]);
  });

  it("collects multiple unique passwords in order with admin fallback", async () => {
    process.env.KJ_SONAR_ADMIN_USER = "user";
    process.env.KJ_SONAR_ADMIN_PASSWORD = "env-pass";
    const config = { sonarqube: { admin_password: "cfg-pass" } };
    loadSonarCredentials.mockResolvedValue({ user: null, password: "file-pass" });
    const result = await resolveSonarCredentials(config);
    expect(result.passwords).toEqual(["env-pass", "cfg-pass", "file-pass", "admin"]);
  });

  it("defaults to admin user and admin password when nothing configured", async () => {
    const result = await resolveSonarCredentials({});
    expect(result.user).toBe("admin");
    expect(result.passwords).toEqual(["admin"]);
  });

  it("deduplicates when explicit password is also admin", async () => {
    process.env.KJ_SONAR_ADMIN_PASSWORD = "admin";
    const result = await resolveSonarCredentials({});
    expect(result.passwords).toEqual(["admin"]);
  });
});
