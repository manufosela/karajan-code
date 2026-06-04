// TDD discipline gate (KJC-TSK-0398 PR1).
// PR1 ships the pure decision logic with injected runTests/stashFiles
// helpers. PR2 ships the real surgical stash. PR3 wires the gate into
// the pipeline behind `development.require_red_then_green`.

const PARSERS = {
  vitest: parseVitestFailures,
  jest: parseVitestFailures,
  pytest: parsePytestFailures,
};

function parseVitestFailures(output) {
  const failures = new Set();
  for (const line of String(output || "").split("\n")) {
    const m = line.match(/^\s*(?:FAIL|×|✖)\s+(\S+)/);
    if (m) failures.add(m[1].trim());
  }
  return failures;
}

function parsePytestFailures(output) {
  const failures = new Set();
  for (const line of String(output || "").split("\n")) {
    const m = line.match(/^FAILED\s+(\S+)/);
    if (m) failures.add(m[1].trim());
  }
  return failures;
}

function anyNewTestIn(failures, testFiles) {
  return [...failures].some((f) => testFiles.some((t) => f.includes(t) || t.includes(f)));
}

export async function verifyTddDiscipline({
  projectDir,
  sourceFiles = [],
  testFiles = [],
  framework = null,
  runTests,
  stashFiles,
  restoreFiles,
} = {}) {
  if (sourceFiles.length === 0) {
    return { ok: true, reason: "no_source_changes", sourceFiles, testFiles };
  }
  if (testFiles.length === 0) {
    return { ok: true, reason: "no_test_changes", sourceFiles, testFiles };
  }

  const parser = framework ? PARSERS[framework] : null;
  if (!parser) {
    return {
      ok: true,
      reason: "framework_unsupported",
      sourceFiles,
      testFiles,
      warning: `tdd-discipline: framework "${framework || "unknown"}" has no failure parser; gate skipped`,
    };
  }

  let stashToken = null;
  try {
    stashToken = await stashFiles(sourceFiles);
    const before = await runTests(projectDir);
    if (!anyNewTestIn(parser(before.output), testFiles)) {
      return {
        ok: false,
        reason: "tests_pass_without_impl",
        sourceFiles,
        testFiles,
        message:
          "TDD discipline violation: new tests pass without the implementation. Tests must fail first (red), then pass (green).",
      };
    }
  } finally {
    if (stashToken) await restoreFiles(stashToken);
  }

  const after = await runTests(projectDir);
  if (anyNewTestIn(parser(after.output), testFiles)) {
    return {
      ok: false,
      reason: "tests_fail_with_impl",
      sourceFiles,
      testFiles,
      message: "TDD discipline violation: new tests still fail with the implementation present.",
    };
  }
  return { ok: true, reason: "red_then_green_verified", sourceFiles, testFiles };
}
