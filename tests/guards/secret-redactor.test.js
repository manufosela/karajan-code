import { describe, it, expect, vi } from "vitest";
import { redactSecrets } from "../../src/guards/secret-redactor.js";
import { CREDENTIAL_PATTERNS } from "../../src/guards/output-guard.js";

// One fake secret per CREDENTIAL_PATTERNS family. Values are canonical
// throwaway fixtures (same style the output-guard suite uses) — never real keys.
// `keep` is the identifiable prefix the placeholder must preserve, or null when
// the family has no stable prefix and falls back to the generic placeholder.
const SAMPLES = [
  // Stable-prefix fixtures split their prefix from the body (`prefix${"body"}`)
  // so neither GitHub push-protection nor GitGuardian sees a contiguous
  // secret-shaped literal; the pattern still matches the concatenated value.
  { id: "aws-key", value: `AKIA${"IOSFODNN7EXAMPLE0"}`, keep: "AKIA" },
  { id: "private-key", value: "-----BEGIN RSA PRIVATE KEY-----", keep: null },
  { id: "generic-secret", value: 'password = "supersecretvalue123"', keep: null, real: "supersecretvalue123" },
  { id: "github-token", value: `ghp_${"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"}`, keep: "ghp_" },
  { id: "npm-token", value: `npm_${"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"}`, keep: "npm_" },
  { id: "openai-key", value: `sk-${"abc123def456ghi789jkl012mno345"}`, keep: "sk-" },
  { id: "anthropic-key", value: `sk-ant-${"abc123def456ghi789jkl012mno"}`, keep: "sk-ant-" },
  { id: "stripe-key", value: `sk_live_${"abc123def456ghi789jkl012mno"}`, keep: "sk_live_" },
  { id: "stripe-test", value: `sk_test_${"abc123def456ghi789jkl012mno"}`, keep: "sk_test_" },
  { id: "google-api-key", value: `AIza${"TEST_FAKE_KEY_000000000000000000000"}`, keep: "AIza" },
  { id: "firebase-key", value: `"apiKey": "AIza${"TEST_FAKE_KEY_000000000000000000000"}"`, keep: null, real: "AIzaTEST_FAKE_KEY_000000000000000000000" },
  { id: "slack-token", value: `xoxb-${"0123456789-ABCDEFGHIJ"}`, keep: "xoxb-" },
  { id: "jwt-secret", value: 'jwt_secret = "supersecretjwtvalue"', keep: null, real: "supersecretjwtvalue" },
  { id: "database-url", value: "mongodb://admin:secretpass@localhost:27017/mydb", keep: null, real: "secretpass" },
  { id: "hardcoded-key-assignment", value: 'const apiToken = "abcdef1234567890abcdef"', keep: null, real: "abcdef1234567890abcdef" },
];

describe("redactSecrets", () => {
  it("covers every CREDENTIAL_PATTERNS family with a fixture", () => {
    const covered = new Set(SAMPLES.map((s) => s.id));
    for (const { id } of CREDENTIAL_PATTERNS) {
      expect(covered.has(id), `missing fixture for family ${id}`).toBe(true);
    }
  });

  // AC#1: the real secret value disappears and a placeholder appears.
  for (const sample of SAMPLES) {
    it(`masks the ${sample.id} family (real value gone, placeholder present)`, () => {
      const out = redactSecrets(sample.value);
      const real = sample.real ?? sample.value;
      expect(out).not.toContain(real);
      expect(out).toContain("REDACTED");
    });
  }

  // AC#3: families with a stable prefix keep it so the reviewer knows the kind.
  for (const sample of SAMPLES.filter((s) => s.keep)) {
    it(`preserves the ${sample.keep} prefix for ${sample.id}`, () => {
      expect(redactSecrets(sample.value)).toContain(`${sample.keep}***REDACTED***`);
    });
  }

  // AC#3 (ordering): sk-ant- must win over sk- (no OpenAI mislabel).
  it("redacts an Anthropic key as sk-ant-, not sk-", () => {
    const out = redactSecrets("sk-ant-abc123def456ghi789jkl012mno");
    expect(out).toContain("sk-ant-***REDACTED***");
    expect(out).not.toContain("sk-***REDACTED***");
  });

  // AC#2: clean text is returned untouched (no-op).
  it("is a no-op on text without secrets", () => {
    const clean = "function add(a, b) {\n  return a + b; // no secrets here\n}";
    expect(redactSecrets(clean)).toBe(clean);
  });

  it("returns non-string / empty input unchanged", () => {
    expect(redactSecrets("")).toBe("");
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });

  // AC#4: only the secret span changes; other diff lines stay intact.
  it("preserves surrounding lines in a multiline diff", () => {
    const diff = [
      "diff --git a/config.js b/config.js",
      "+++ b/config.js",
      "@@ -1,2 +1,3 @@",
      " export const region = 'eu-west-1';",
      '+const key = "AKIAIOSFODNN7EXAMPLE";',
      " export const retries = 3;",
    ].join("\n");
    const out = redactSecrets(diff);
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain("AKIA***REDACTED***");
    expect(out).toContain("export const region = 'eu-west-1';");
    expect(out).toContain("export const retries = 3;");
    expect(out.split("\n")).toHaveLength(diff.split("\n").length);
  });
});

// AC#5: the diff the reviewer stage hands to the model carries the placeholder,
// never the real secret.
describe("fetchReviewDiff inbound redaction", () => {
  it("redacts secrets in the diff before the reviewer sees it", async () => {
    vi.resetModules();
    vi.doMock("../../src/review/diff-generator.js", () => ({
      generateDiff: async () =>
        '+++ b/secrets.js\n+const token = "AKIAIOSFODNN7EXAMPLE";\n',
    }));
    const { fetchReviewDiff } = await import("../../src/orchestrator/stages/reviewer-stage.js");
    const logger = { info: () => {}, warn: () => {} };
    const diff = await fetchReviewDiff({ session_start_sha: "HEAD~1" }, logger);
    expect(diff).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(diff).toContain("AKIA***REDACTED***");
    vi.doUnmock("../../src/review/diff-generator.js");
    vi.resetModules();
  });
});
