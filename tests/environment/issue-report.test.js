// AB-F (KJC-TSK-0655): self-healing by issues. The brain diagnoses; kj
// composes a SANITIZED report (public output is a privacy boundary: no
// home paths, no usernames, no emails, never project code) and dedups
// against the public repo before anything is published.
import { describe, it, expect, vi } from "vitest";
import { composeIssue, sanitize, findSimilarIssues, newIssueUrl } from "../../src/environment/issue-report.js";

describe("sanitize", () => {
  it("redacts home paths, usernames and emails", () => {
    const dirty = [
      "Error at /home/manu/ws_npm-packages/karajan-code/src/x.js",
      "mac path /Users/jcasar/.nvm/versions/node",
      "contact: someone@example.com",
    ].join("\n");
    const clean = sanitize(dirty);
    expect(clean).not.toMatch(/\/home\/manu|jcasar|someone@example\.com/);
    expect(clean).toMatch(/~\/ws_npm-packages\/karajan-code\/src\/x\.js/);
    expect(clean).toMatch(/~\/\.nvm\/versions\/node/);
    expect(clean).toMatch(/\[redacted-email\]/);
  });

  it("leaves normal technical content untouched", () => {
    const text = "better-sqlite3 native addon failed: exit code 1";
    expect(sanitize(text)).toBe(text);
  });
});

describe("composeIssue", () => {
  it("builds a body with environment metadata and sanitized sections", () => {
    const { title, body } = composeIssue({
      title: "MCP fails from SEA binary",
      command: "kj doctor",
      error: "better-sqlite3 missing at /home/manu/.local/bin/kj",
      description: "Installed via curl; doctor FAILs on karajan-mcp.",
      env: { kjVersion: "4.0.1", nodeVersion: "22.12.0", platform: "darwin-arm64" },
    });
    expect(title).toBe("MCP fails from SEA binary");
    expect(body).toMatch(/kj 4\.0\.1/);
    expect(body).toMatch(/node 22\.12\.0/);
    expect(body).toMatch(/darwin-arm64/);
    expect(body).toMatch(/kj doctor/);
    expect(body).not.toMatch(/\/home\/manu/);
    expect(body).toMatch(/reported via `kj report-issue`/i);
  });
});

describe("findSimilarIssues", () => {
  const issues = [
    { number: 12, title: "SEA binary breaks karajan-mcp (better-sqlite3 missing)", html_url: "https://github.com/manufosela/karajan-code/issues/12" },
    { number: 9, title: "kj harden overwrites global hooks", html_url: "u9" },
  ];

  it("matches open issues sharing meaningful title words", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => issues });
    const hits = await findSimilarIssues("MCP fails: better-sqlite3 missing from SEA binary", { fetchFn });
    expect(hits.map((h) => h.number)).toEqual([12]);
    expect(fetchFn.mock.calls[0][0]).toMatch(/repos\/manufosela\/karajan-code\/issues/);
  });

  it("API failure degrades to empty (reporting must not depend on the dedup)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await findSimilarIssues("anything", { fetchFn })).toEqual([]);
  });
});

describe("newIssueUrl", () => {
  it("prefills title and body, URL-encoded", () => {
    const url = newIssueUrl({ title: "A & B", body: "line\nline2" });
    expect(url).toMatch(/^https:\/\/github\.com\/manufosela\/karajan-code\/issues\/new\?/);
    expect(url).toMatch(/title=A%20%26%20B/);
    expect(url).toMatch(/body=line%0Aline2/);
  });
});
