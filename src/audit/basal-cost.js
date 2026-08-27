import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getKarajanHome } from "../utils/paths.js";
import { sniffManifests, summariseStack } from "../utils/manifest-sniff.js";

const execFileAsync = promisify(execFile);

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
  return path.basename(projectDir).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

async function walkSourceFiles(dir) {
  // Use git ls-files for speed (instant vs recursive walk)
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: dir, encoding: "utf8", timeout: 5000 });
    return stdout.trim().split("\n")
      .filter(f => f && SOURCE_EXTENSIONS.has(path.extname(f)) && !EXCLUDE_DIRS.has(f.split("/")[0]))
      .map(f => path.join(dir, f));
  } catch {
    // Fallback to recursive walk if not a git repo
    const files = [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { /* directory not readable */
      return files;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walkSourceFiles(full));
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
    return files;
  }
}

async function countLines(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

function countDependenciesFromStack(stack) {
  // Suma deps + devDeps de TODOS los manifests detectados (multi-stack).
  // Si no hay manifests, devuelve ceros — coherente con repos sin paquete.
  let deps = 0;
  let devDeps = 0;
  for (const m of stack.manifests) {
    deps += m.deps;
    devDeps += m.devDeps;
  }
  return { dependencies: deps, devDependencies: devDeps, total: deps + devDeps };
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

// Regexes hoisted to module scope so they're compiled once instead of per file.
// Naming: *Re catches static/syntactic patterns; we still rely on the import set
// being a superset (false negative > false positive in audit context).
const EXPORT_RE = /export\s+(?:default\s+)?(?:function|class|const|let|var|async\s+function)\s+(\w+)/g;
const NAMED_EXPORT_RE = /export\s*\{([^}]+)\}/g;
const STATIC_NAMED_IMPORT_RE = /import\s+\{([^}]+)\}\s+from/g;
const DEFAULT_IMPORT_RE = /import\s+(\w+)\s+from/g;
// Namespace import (`import * as ns from <path>`) — knip-equivalent: mark
// the target file as fully-consumed because we cannot statically know
// which `ns.X` accesses happen.
const NAMESPACE_IMPORT_RE = /import\s+\*\s+as\s+\w+\s+from\s+["']([^"']+)["']/g;
// Any dynamic `await import(<path>)` — destructured, late-bound, or
// member-accessed. Conservatively mark the target as fully-consumed:
// trying to enumerate downstream destructuring/member-access patterns is
// fragile (the same test may use parenthesised assignment with no const,
// or bind first and `.foo`-access later). A false-negative here (one
// extra "live" export we can't prove dead) is always cheaper than a
// false-positive in audit context.
const DYNAMIC_IMPORT_RE = /\bawait\s+import\s*\(\s*["']([^"']+)["']\s*\)/g;
// Re-export bridges (`export { x } from <path>` and `export * from <path>`)
// — both consume from the target file (the re-exporter is itself another
// file consumer downstream).
const RE_EXPORT_NAMED_RE = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
const RE_EXPORT_STAR_RE = /export\s*\*\s*from\s*["']([^"']+)["']/g;
// Export preceded by a JSDoc block with `@internal` is opt-out: documented as
// dynamic-import-only or test-fixture surface that the regex passes can't see.
const INTERNAL_EXPORT_RE = /\/\*\*[\s\S]*?@internal[\s\S]*?\*\/\s*export\s+(?:default\s+)?(?:function|class|const|let|var|async\s+function)\s+(\w+)/g;

function resolveImportSpecifier(fromFile, specifier) {
  // Only resolve project-relative paths; bare specifiers (npm packages) and
  // node: builtins are not in our exportMap and don't matter here.
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  // Caller will probe both with and without explicit extensions.
  return base.endsWith(".js") || base.endsWith(".mjs") || base.endsWith(".cjs")
    || base.endsWith(".ts") || base.endsWith(".tsx")
    ? base
    : `${base}.js`;
}

// Strip every string literal (template, double, single) from the content
// before scanning for export declarations. Test files routinely embed
// sample source code inside fixtures (template literals for plugin
// modules, double-quoted diff lines for prompt tests, etc.). At top level
// `export ...` is a statement, never an expression, so it can never
// legitimately appear inside a quoted string in real code — meaning the
// strip is safe for export detection. We do NOT use this stripped view
// for import detection: the import regexes anchor on `import {...} from`
// regardless of the path string, but the namespace/dynamic-import passes
// need the actual path inside the quotes to resolve the target module.
function stripStringLiterals(content) {
  return content
    .replaceAll(/`[^`]*`/g, "``")
    .replaceAll(/"(?:\\.|[^"\\])*"/g, '""')
    .replaceAll(/'(?:\\.|[^'\\])*'/g, "''");
}

async function findDeadExports(sourceFiles) {
  const exportMap = new Map(); // file -> [exportName]
  const internalExportsByFile = new Map(); // file -> Set<exportName>
  const importedNames = new Set();
  const fullyConsumedFiles = new Set(); // resolved file paths reached via `import *` or bound dynamic import

  for (const file of sourceFiles) {
    let content;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const exportContent = stripStringLiterals(content);

    const exports = [];
    for (const match of exportContent.matchAll(EXPORT_RE)) {
      exports.push(match[1]);
    }
    for (const match of exportContent.matchAll(NAMED_EXPORT_RE)) {
      const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/).pop().trim());
      exports.push(...names);
    }
    if (exports.length > 0) {
      exportMap.set(file, exports);
    }

    // Collect `@internal`-tagged exports up front so the dead-pass can skip them.
    const internalSet = new Set();
    for (const match of exportContent.matchAll(INTERNAL_EXPORT_RE)) {
      internalSet.add(match[1]);
    }
    if (internalSet.size > 0) {
      internalExportsByFile.set(file, internalSet);
    }

    for (const match of content.matchAll(STATIC_NAMED_IMPORT_RE)) {
      const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
      for (const name of names) importedNames.add(name);
    }
    for (const match of content.matchAll(DEFAULT_IMPORT_RE)) {
      importedNames.add(match[1]);
    }
    for (const match of content.matchAll(NAMESPACE_IMPORT_RE)) {
      const resolved = resolveImportSpecifier(file, match[1]);
      if (resolved) fullyConsumedFiles.add(resolved);
    }
    for (const match of content.matchAll(DYNAMIC_IMPORT_RE)) {
      const resolved = resolveImportSpecifier(file, match[1]);
      if (resolved) fullyConsumedFiles.add(resolved);
    }
    for (const match of content.matchAll(RE_EXPORT_NAMED_RE)) {
      const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
      for (const name of names) importedNames.add(name);
    }
    for (const match of content.matchAll(RE_EXPORT_STAR_RE)) {
      const resolved = resolveImportSpecifier(file, match[1]);
      if (resolved) fullyConsumedFiles.add(resolved);
    }
  }

  const dead = [];
  for (const [file, exports] of exportMap) {
    if (fullyConsumedFiles.has(file)) continue; // module imported via * or bound await import — can't tell which exports are used
    const internalSet = internalExportsByFile.get(file);
    for (const name of exports) {
      if (internalSet?.has(name)) continue; // explicitly opted out via @internal
      if (!importedNames.has(name)) {
        dead.push({ file, name });
      }
    }
  }
  return dead;
}

export async function measureBasalCost(projectDir) {
  const sourceFiles = await walkSourceFiles(projectDir);
  let totalLines = 0;
  for (const f of sourceFiles) {
    totalLines += await countLines(f);
  }

  const stack = summariseStack(await sniffManifests(projectDir));
  const depInfo = countDependenciesFromStack(stack);
  // depcheck solo aplica a Node; en stacks puros no-Node lo saltamos.
  const hasNode = stack.manifests.some((m) => m.stack === "node");
  const depcheck = hasNode ? await runDepcheck(projectDir) : { unused: [], note: "depcheck skipped (no package.json)" };
  const deadExports = await findDeadExports(sourceFiles);

  return {
    totalLines,
    totalFiles: sourceFiles.length,
    dependencies: depInfo,
    unusedDependencies: depcheck,
    deadExports,
    stack
  };
}

function auditDir() {
  return path.join(getKarajanHome(), "audits");
}

export async function loadPreviousAudit(projectDir) {
  const file = path.join(auditDir(), slugify(projectDir), "latest.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function saveAuditSnapshot(projectDir, metrics) {
  const dir = path.join(auditDir(), slugify(projectDir));
  await fs.mkdir(dir, { recursive: true });
  const snapshot = { ...metrics, timestamp: new Date().toISOString() };
  await fs.writeFile(path.join(dir, "latest.json"), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export function computeGrowthDelta(current, previous) {
  if (!previous) return null;
  // AC8 (KJC-TSK-0794): "not measured before" must never read as "unchanged" —
  // the derivative only exists when BOTH snapshots actually measured it.
  const bothMeasured = Array.isArray(current.deadExports) && Array.isArray(previous.deadExports);
  return {
    lines: current.totalLines - previous.totalLines,
    files: current.totalFiles - previous.totalFiles,
    deps: current.dependencies.total - (previous.dependencies?.total ?? 0),
    deadExports: bothMeasured ? current.deadExports.length - previous.deadExports.length : null,
    since: previous.timestamp || null
  };
}
