import { describe, it, expect } from "vitest";
import { docLink, withDocLink } from "../src/utils/doc-links.js";

const BASE_URL = "https://karajancode.com/docs";

describe("docLink", () => {
  it("returns correct URL for sonar_token", () => {
    expect(docLink("sonar_token")).toBe(`${BASE_URL}/guides/configuration/#sonarqube`);
  });

  it("returns correct URL for sonar_docker", () => {
    expect(docLink("sonar_docker")).toBe(`${BASE_URL}/getting-started/installation/#docker`);
  });

  it("returns correct URL for agent_not_found", () => {
    expect(docLink("agent_not_found")).toBe(`${BASE_URL}/getting-started/installation/#agents`);
  });

  it("returns correct URL for bootstrap_failed", () => {
    expect(docLink("bootstrap_failed")).toBe(`${BASE_URL}/guides/troubleshooting/`);
  });

  it("returns correct URL for config_missing", () => {
    expect(docLink("config_missing")).toBe(`${BASE_URL}/getting-started/quick-start/`);
  });

  it("returns correct URL for branch_error", () => {
    expect(docLink("branch_error")).toBe(`${BASE_URL}/guides/pipeline/#git-workflow`);
  });

  it("returns correct URL for rtk_install", () => {
    expect(docLink("rtk_install")).toBe(`${BASE_URL}/guides/configuration/#rtk`);
  });

  it("returns troubleshooting URL for unknown error type", () => {
    expect(docLink("some_unknown_error")).toBe(`${BASE_URL}/guides/troubleshooting/`);
  });

  it("returns troubleshooting URL for undefined", () => {
    expect(docLink(undefined)).toBe(`${BASE_URL}/guides/troubleshooting/`);
  });
});

describe("withDocLink", () => {
  it("appends See: line with correct URL", () => {
    const result = withDocLink("Token not found", "sonar_token");
    expect(result).toBe(`Token not found\n  See: ${BASE_URL}/guides/configuration/#sonarqube`);
  });

  it("appends troubleshooting link for unknown type", () => {
    const result = withDocLink("Something went wrong", "unknown_type");
    expect(result).toContain("\n  See:");
    expect(result).toContain("/guides/troubleshooting/");
  });

  it("preserves original message", () => {
    const msg = "Bootstrap failed: missing config";
    const result = withDocLink(msg, "bootstrap_failed");
    expect(result.startsWith(msg)).toBe(true);
  });
});
