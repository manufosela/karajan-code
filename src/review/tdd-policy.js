function extractChangedFiles(diff) {
  const files = new Set();
  const lines = String(diff || "").split("\n");
  for (const line of lines) {
    if (!line.startsWith("diff --git ")) continue;
    const parts = line.split(" ");
    const b = parts[3] || "";
    if (b.startsWith("b/")) files.add(b.slice(2));
  }
  return [...files];
}

function isTestFile(file, patterns = []) {
  const normalized = `/${file}`;
  return patterns.some((pattern) => normalized.includes(pattern));
}

function isSourceFile(file, extensions = []) {
  return extensions.some((ext) => file.endsWith(ext));
}

const SKIP_TDD_TASK_TYPES = new Set(["doc", "infra"]);

export function evaluateTddPolicy(diff, developmentConfig = {}, untrackedFiles = [], taskType = null) {
  if (taskType && SKIP_TDD_TASK_TYPES.has(taskType)) {
    return { ok: true, reason: "tdd_not_applicable_for_task_type", sourceFiles: [], testFiles: [] };
  }

  const requireTestChanges = developmentConfig.require_test_changes !== false;
  const patterns = developmentConfig.test_file_patterns || ["/tests/", "/__tests__/", ".test.", ".spec."];
  const extensions =
    developmentConfig.source_file_extensions || [".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".php", ".cs"];

  const diffFiles = extractChangedFiles(diff);
  const extra = Array.isArray(untrackedFiles) ? untrackedFiles : [];
  const files = [...new Set([...diffFiles, ...extra])];
  const sourceFiles = files.filter((f) => isSourceFile(f, extensions) && !isTestFile(f, patterns));
  const testFiles = files.filter((f) => isTestFile(f, patterns));

  if (!requireTestChanges) {
    return {
      ok: true,
      reason: "test_changes_not_required",
      sourceFiles,
      testFiles
    };
  }

  if (sourceFiles.length === 0) {
    return { ok: true, reason: "no_source_changes", sourceFiles, testFiles };
  }

  if (testFiles.length === 0) {
    return {
      ok: false,
      reason: "source_changes_without_tests",
      sourceFiles,
      testFiles,
      message:
        "TDD policy violation: source code changed without test changes. Add/adjust tests first, then implementation."
    };
  }

  return { ok: true, reason: "tests_present", sourceFiles, testFiles };
}
