/**
 * Tests-with-code gate (KJC-TSK-0687, MG-B of épica KJC-PCS-0068). The
 * verifiable half of TDD is deterministic: a staged diff that touches
 * source files without touching a single test warns — or blocks, via
 * `method_gates.tests_with_code`. Test-FIRST remains the reviewer's
 * judgment; test-PRESENT belongs to the gate. Patterns come from the
 * project's own `development.*` config (same ones headless enforces).
 * KJ_ALLOW_NO_TESTS=1 is the explicit escape hatch.
 */

const DEFAULT_TEST_PATTERNS = ["/tests/", "/__tests__/", ".test.", ".spec."];
const DEFAULT_SOURCE_EXTS = [".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".php", ".cs"];

export function checkTestsWithCode({ config = {}, stagedFiles = [], numstat = null, env = process.env }) {
  if (env.KJ_ALLOW_NO_TESTS === "1") {
    return { ok: true, mode: "exempt", reason: "KJ_ALLOW_NO_TESTS=1 (explicit escape hatch)" };
  }
  const patterns = config.development?.test_file_patterns || DEFAULT_TEST_PATTERNS;
  const exts = config.development?.source_file_extensions || DEFAULT_SOURCE_EXTS;
  // Staged paths are repo-relative (no leading slash) — normalize so the
  // "/tests/" style patterns also match the top-level tests directory.
  const isTest = (f) => patterns.some((p) => `/${f}`.includes(p));
  const sources = stagedFiles.filter((f) => !isTest(f) && exts.some((e) => f.endsWith(e)));
  const hasTests = stagedFiles.some(isTest);

  if (sources.length === 0 || hasTests) return { ok: true, mode: "pass" };
  // KJC-TSK-0795 AC1 (epic KJC-PCS-0082): deleting code adds no behavior to
  // test. When the caller hands the numbers and EVERY touched source only
  // removed lines, the gate stands down — demanding a test here is the false
  // positive that teaches people to skip the gate (measured in GREBLA's two
  // cleanup PRs). Callers that only know names keep the old behavior.
  if (Array.isArray(numstat)) {
    const bySource = numstat.filter((n) => sources.includes(n.file));
    if (bySource.length === sources.length && bySource.every((n) => (n.added || 0) === 0)) {
      return { ok: true, mode: "delete-only", sources, reason: "every touched source only removes lines — deleting is not new behavior" };
    }
  }

  const policy = config.method_gates?.tests_with_code || "warn";
  const reason = `source changes without any test change (${sources.slice(0, 5).join(", ")}${sources.length > 5 ? "…" : ""}) — the failing test comes first; add one or KJ_ALLOW_NO_TESTS=1 for a deliberate exception`;
  return policy === "block"
    ? { ok: false, mode: "block", sources, reason }
    : { ok: true, mode: "warn", sources, reason };
}
