import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { getKarajanHome } from "../utils/paths.js";

const SOURCE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h",
  ".vue", ".svelte", ".astro", ".php", ".cs", ".sh"
]);

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next",
  ".nuxt", ".output", "__pycache__", ".cache", ".parcel-cache"
]);

function slugify(projectDir) {
  return path.basename(projectDir).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function walkSourceFiles(dir) {
  // Use git ls-files for speed (instant vs recursive walk)
  try {
    const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: dir, encoding: "utf8", timeout: 5000 });
    return output.trim().split("\n")
      .filter(f => f && SOURCE_EXTENSIONS.has(path.extname(f)) && !EXCLUDE_DIRS.has(f.split("/")[0]))
      .map(f => path.join(dir, f));
  } catch {
    // Fallback to recursive walk if not a git repo
    const files = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkSourceFiles(full));
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
    return files;
  }
}

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

function countDependencies(projectDir) {
  const pkgPath = path.join(projectDir, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const deps = Object.keys(pkg.dependencies || {});
    const devDeps = Object.keys(pkg.devDependencies || {});
    return { dependencies: deps.length, devDependencies: devDeps.length, total: deps.length + devDeps.length };
  } catch {
    return { dependencies: 0, devDependencies: 0, total: 0 };
  }
}

function runDepcheck(projectDir) {
  return new Promise((resolve) => {
    execFile("npx", ["depcheck", "--json"], { cwd: projectDir, timeout: 30000 }, (err, stdout) => {
      if (err && !stdout) {
        resolve({ unused: [], note: "depcheck not available or failed" });
        return;
      }
      try {
        const result = JSON.parse(stdout);
        const unused = [
          ...(result.dependencies || []),
          ...(result.devDependencies || [])
        ];
        resolve({ unused });
      } catch {
        resolve({ unused: [], note: "depcheck output not parseable" });
      }
    });
  });
}

function findDeadExports(sourceFiles) {
  const exportMap = new Map(); // file -> [exportName]
  const importedNames = new Set();

  const exportRe = /export\s+(?:default\s+)?(?:function|class|const|let|var|async\s+function)\s+(\w+)/g;
  const namedExportRe = /export\s*\{([^}]+)\}/g;
  const importRe = /import\s+\{([^}]+)\}\s+from/g;
  const defaultImportRe = /import\s+(\w+)\s+from/g;

  for (const file of sourceFiles) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const exports = [];
    for (const match of content.matchAll(exportRe)) {
      exports.push(match[1]);
    }
    for (const match of content.matchAll(namedExportRe)) {
      const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/).pop().trim());
      exports.push(...names);
    }
    if (exports.length > 0) {
      exportMap.set(file, exports);
    }

    for (const match of content.matchAll(importRe)) {
      const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
      for (const name of names) importedNames.add(name);
    }
    for (const match of content.matchAll(defaultImportRe)) {
      importedNames.add(match[1]);
    }
  }

  const dead = [];
  for (const [file, exports] of exportMap) {
    for (const name of exports) {
      if (!importedNames.has(name)) {
        dead.push({ file, name });
      }
    }
  }
  return dead;
}

export async function measureBasalCost(projectDir) {
  const sourceFiles = walkSourceFiles(projectDir);
  let totalLines = 0;
  for (const f of sourceFiles) {
    totalLines += countLines(f);
  }

  const depInfo = countDependencies(projectDir);
  const depcheck = await runDepcheck(projectDir);
  const deadExports = findDeadExports(sourceFiles);

  return {
    totalLines,
    totalFiles: sourceFiles.length,
    dependencies: depInfo,
    unusedDependencies: depcheck,
    deadExports
  };
}

function auditDir() {
  return path.join(getKarajanHome(), "audits");
}

export function loadPreviousAudit(projectDir) {
  const file = path.join(auditDir(), slugify(projectDir), "latest.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function saveAuditSnapshot(projectDir, metrics) {
  const dir = path.join(auditDir(), slugify(projectDir));
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = { ...metrics, timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export function computeGrowthDelta(current, previous) {
  if (!previous) return null;
  return {
    lines: current.totalLines - previous.totalLines,
    files: current.totalFiles - previous.totalFiles,
    deps: current.dependencies.total - (previous.dependencies?.total ?? 0),
    since: previous.timestamp || null
  };
}
