// KJC-TSK-0476 — Multi-stack manifest sniffer. Sin libs externas: JSON.parse
// para package.json, regex para TOML y go.mod. Lo consumen audit (basal-cost)
// y, vía PR-D, el onboarder.
import fs from "node:fs/promises";
import path from "node:path";

async function readMaybe(file) {
  try { return await fs.readFile(file, "utf8"); } catch { return null; }
}

async function sniffNode(dir) {
  const raw = await readMaybe(path.join(dir, "package.json"));
  if (!raw) return null;
  try {
    const pkg = JSON.parse(raw);
    return { stack: "node", manifest: "package.json", name: pkg.name || null,
      deps: Object.keys(pkg.dependencies || {}).length,
      devDeps: Object.keys(pkg.devDependencies || {}).length };
  } catch {
    return { stack: "node", manifest: "package.json", name: null, deps: 0, devDeps: 0, malformed: true };
  }
}

// Cuerpo TOML de `[section]` hasta el siguiente `\n[` o EOF. Lookahead con `/m`
// cambia el significado de `$` y producía capturas vacías.
function tomlSection(toml, section) {
  const i = toml.indexOf(`[${section}]`);
  if (i === -1) return "";
  const rest = toml.slice(i + section.length + 2);
  const n = rest.search(/\n\[/);
  return n === -1 ? rest : rest.slice(0, n);
}

const DEP_LINE_RE = /^\s*[A-Za-z0-9_-]+\s*=/;
const countDepLines = (block, excludePython) => block.split("\n")
  .filter((l) => DEP_LINE_RE.test(l) && !(excludePython && /^\s*python\s*=/.test(l))).length;

async function sniffPython(dir) {
  const py = await readMaybe(path.join(dir, "pyproject.toml"));
  if (py) {
    const name = /^name\s*=\s*["']([^"']+)["']/m.exec(py)?.[1] || null;
    const projectDeps = /\[project\][\s\S]*?dependencies\s*=\s*\[([^\]]*)\]/m.exec(py)?.[1] || "";
    const projectCount = projectDeps.split(",").map((s) => s.trim()).filter(Boolean).length;
    const poetryCount = countDepLines(tomlSection(py, "tool.poetry.dependencies"), true);
    return { stack: "python", manifest: "pyproject.toml", name, deps: projectCount + poetryCount, devDeps: 0 };
  }
  const req = await readMaybe(path.join(dir, "requirements.txt"));
  if (!req) return null;
  const lines = req.split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  return { stack: "python", manifest: "requirements.txt", name: null, deps: lines.length, devDeps: 0 };
}

async function sniffRust(dir) {
  const toml = await readMaybe(path.join(dir, "Cargo.toml"));
  if (!toml) return null;
  return { stack: "rust", manifest: "Cargo.toml",
    name: /^name\s*=\s*["']([^"']+)["']/m.exec(toml)?.[1] || null,
    deps: countDepLines(tomlSection(toml, "dependencies")),
    devDeps: countDepLines(tomlSection(toml, "dev-dependencies")) };
}

async function sniffGo(dir) {
  const mod = await readMaybe(path.join(dir, "go.mod"));
  if (!mod) return null;
  const block = /require\s*\(([\s\S]*?)\)/m.exec(mod)?.[1] || "";
  const blockCount = block.split("\n").filter((l) => /\S/.test(l) && !l.trim().startsWith("//")).length;
  const singleCount = mod.split("\n").filter((l) => /^require\s+\S+\s+\S+/.test(l)).length;
  return { stack: "go", manifest: "go.mod",
    name: /^module\s+(\S+)/m.exec(mod)?.[1] || null,
    deps: blockCount + singleCount, devDeps: 0 };
}

export async function sniffManifests(dir) {
  const r = await Promise.all([sniffNode(dir), sniffPython(dir), sniffRust(dir), sniffGo(dir)]);
  return r.filter(Boolean);
}

export function summariseStack(manifests) {
  if (!manifests.length) return { primary: null, multi: false, manifests: [] };
  const ranked = [...manifests].sort((a, b) => (b.deps + b.devDeps) - (a.deps + a.devDeps));
  return { primary: ranked[0].stack, multi: manifests.length > 1, manifests };
}
