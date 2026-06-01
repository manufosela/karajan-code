// KJC-TSK-0477 — Detectores mínimos de framework por stack (Python/Rust/Go).
// Consume el sniff de manifests (PR-C) para conocer deps + presencia de
// archivos canónicos. Cero deps externas, fail-soft (devuelve null o lista
// vacía). El brief markdown se sintetiza río abajo desde estos campos.
import { existsSync } from "node:fs";
import path from "node:path";

const PY_FW = [
  { name: "django", deps: ["django"], file: "manage.py" },
  { name: "flask", deps: ["flask"], file: "app.py" },
  { name: "fastapi", deps: ["fastapi"], file: "main.py" },
];
const RUST_FW = [
  { name: "axum", deps: ["axum"] },
  { name: "actix-web", deps: ["actix-web"] },
  { name: "rocket", deps: ["rocket"] },
];
const GO_FW = [
  { name: "gin", deps: ["github.com/gin-gonic/gin"] },
  { name: "echo", deps: ["github.com/labstack/echo"] },
  { name: "fiber", deps: ["github.com/gofiber/fiber"] },
];

function matchFw(manifestRaw, projectDir, table) {
  const found = [];
  for (const fw of table) {
    const hasDep = fw.deps.some((d) => manifestRaw?.includes(d));
    const hasFile = fw.file ? existsSync(path.join(projectDir, fw.file)) : false;
    if (hasDep || hasFile) found.push({ name: fw.name, viaDep: hasDep, viaFile: hasFile });
  }
  return found;
}

function detectLayout(projectDir, expected) {
  return expected.filter((d) => existsSync(path.join(projectDir, d)));
}

// Detect frameworks + canonical layout per stack. Returns one entry per
// detected manifest stack (skips Node — the existing JS path already covers
// that with detectProjectStack).
export function detectFrameworksMultiLang(projectDir, manifests = [], { readManifest } = {}) {
  const out = [];
  for (const m of manifests) {
    if (m.stack === "node") continue;
    const raw = readManifest ? readManifest(m) : "";
    if (m.stack === "python") {
      out.push({ stack: "python", manifest: m.manifest,
        frameworks: matchFw(raw, projectDir, PY_FW),
        layout: detectLayout(projectDir, ["apps", "src", "tests"]) });
    } else if (m.stack === "rust") {
      const isBin = existsSync(path.join(projectDir, "src", "main.rs"));
      const isLib = existsSync(path.join(projectDir, "src", "lib.rs"));
      out.push({ stack: "rust", manifest: m.manifest,
        crateType: isBin && isLib ? "mixed" : isBin ? "binary" : isLib ? "library" : null,
        frameworks: matchFw(raw, projectDir, RUST_FW),
        layout: detectLayout(projectDir, ["src", "tests", "examples", "benches"]) });
    } else if (m.stack === "go") {
      out.push({ stack: "go", manifest: m.manifest, modulePath: m.name || null,
        frameworks: matchFw(raw, projectDir, GO_FW),
        layout: detectLayout(projectDir, ["cmd", "internal", "pkg"]) });
    }
  }
  return out;
}
