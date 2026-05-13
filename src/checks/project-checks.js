/**
 * Project-aware preflight checks (KJC-TSK-0393).
 *
 * `kj doctor` (global) y el preflight estándar verifican el ENTORNO de Karajan
 * (CLIs instaladas, node, dirs ~/.karajan/, sonar). Pero **nada** validaba que
 * el PROYECTO actual tuviera lo que necesita: tools detectables por signals
 * (docker si hay Dockerfile, firebase si hay firebase.json, etc.), permisos
 * write sobre projectDir, configuración inicializada, .env consistente con
 * .env.example.
 *
 * Este módulo registra checks dinámicos basados en signals del proyecto. Se
 * integra en preflight-checks.js como "fase project-aware" tras la fase global.
 * También expone `kj doctor --project` para ejecutar solo esta fase manualmente.
 *
 * Filosofía: si un check falla, el mensaje incluye el comando EJECUTABLE para
 * resolverlo (no "Run X or Y"), y siempre que sea posible se marca como
 * `degradable` (KJC-BUG-0049) para no abortar runs por features opcionales.
 */

import fs from "node:fs";
import path from "node:path";
import { runCommand } from "../utils/process.js";
import { checkBinary } from "../utils/agent-detect.js";
import { getInstallCommand } from "../utils/os-detect.js";
import { STRATEGY } from "./types.js";

/**
 * Detect signals del proyecto. Devuelve un set de tags con qué hay en el
 * projectDir. Pure-function, solo I/O de filesystem síncrono (rápido).
 *
 * @param {string} projectDir
 * @returns {Set<string>}
 */
export function detectProjectSignals(projectDir) {
  const signals = new Set();
  if (!projectDir || !fs.existsSync(projectDir)) return signals;
  const has = (rel) => fs.existsSync(path.join(projectDir, rel));
  if (has("package.json")) signals.add("node");
  if (has("Dockerfile") || has("docker-compose.yml") || has("compose.yml")) signals.add("docker");
  if (has("firebase.json") || has(".firebaserc")) signals.add("firebase");
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) signals.add("python");
  if (has("Cargo.toml")) signals.add("rust");
  if (has("go.mod")) signals.add("go");
  if (has(".env.example") || has(".env.sample") || has(".env.template")) signals.add("env-example");
  if (has(".env")) signals.add("env");
  // Terraform / OpenTofu
  try {
    const entries = fs.readdirSync(projectDir);
    if (entries.some((e) => e.endsWith(".tf") || e.endsWith(".tofu"))) signals.add("terraform");
  } catch { /* unreadable dir */ }
  return signals;
}

/**
 * Check de tool específico del signal. Si el signal está presente pero la tool
 * no, emite WARN con install command ejecutable.
 */
function createToolCheck({ signal, tool, label, signals }) {
  return {
    name: `project:tool:${tool}`,
    label,
    strategy: STRATEGY.MANUAL,
    applies: () => signals.has(signal),
    async detect() {
      const res = await checkBinary(tool);
      if (res.ok) {
        return { ok: true, severity: "info", detail: `${tool} ${res.version} — required by ${signal} signal` };
      }
      const installCmd = getInstallCommand(tool) || `<install ${tool} for your OS>`;
      return {
        ok: false,
        severity: "warn",
        detail: `${tool} no instalada pero el proyecto tiene signal '${signal}' (puede no necesitarla para esta HU, pero la mayoría sí)`,
        fix: installCmd,
      };
    },
  };
}

/**
 * Permisos write check. Critical: si projectDir, .kj/ o .karajan/ no son
 * escribibles, el pipeline va a fallar muy tarde con errores oscuros.
 */
function createWritePermsCheck({ projectDir }) {
  return {
    name: "project:write-perms",
    label: "Write permissions (projectDir + .kj/ + .karajan/)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const targets = [
        projectDir,
        path.join(projectDir, ".kj"),
        path.join(projectDir, ".karajan"),
      ];
      const failed = [];
      for (const target of targets) {
        try {
          if (!fs.existsSync(target)) continue;
          fs.accessSync(target, fs.constants.W_OK);
        } catch {
          failed.push(target);
        }
      }
      if (failed.length === 0) {
        return { ok: true, severity: "info", detail: "Karajan puede escribir en projectDir, .kj/ y .karajan/" };
      }
      return {
        ok: false,
        severity: "fail",
        detail: `Sin permisos de escritura en: ${failed.join(", ")}`,
        fix: `chmod -R u+w ${failed.join(" ")}`,
      };
    },
  };
}

/**
 * .env consistency check: si existe .env.example pero NO .env, o si las vars
 * que .env.example declara faltan en .env, emite WARN con la lista.
 */
function createEnvConsistencyCheck({ projectDir, signals }) {
  return {
    name: "project:env-consistency",
    label: ".env consistency (vs .env.example)",
    strategy: STRATEGY.MANUAL,
    applies: () => signals.has("env-example"),
    async detect() {
      const exampleFile = ["env.example", ".env.sample", ".env.template"]
        .map((n) => path.join(projectDir, n.startsWith(".") ? n : `.${n}`))
        .find((p) => fs.existsSync(p));
      const realFile = path.join(projectDir, ".env");
      const declaredVars = parseEnvKeys(exampleFile);
      if (declaredVars.length === 0) {
        return { ok: true, severity: "info", detail: ".env.example sin variables declaradas" };
      }
      const realVars = fs.existsSync(realFile) ? new Set(parseEnvKeys(realFile)) : new Set();
      const missing = declaredVars.filter((k) => !realVars.has(k));
      if (missing.length === 0) {
        return { ok: true, severity: "info", detail: `.env tiene las ${declaredVars.length} variables declaradas en .env.example` };
      }
      return {
        ok: false,
        severity: "warn",
        detail: `.env no declara ${missing.length} variable(s) que sí están en .env.example: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`,
        fix: `cp ${path.basename(exampleFile)} .env && edit it`,
      };
    },
  };
}

function parseEnvKeys(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => l.split("=")[0].trim())
      .filter(Boolean);
  } catch { return []; }
}

/**
 * gh remote-specific check: cuando auto_pr está activo, no basta con que `gh`
 * esté autenticado en general (eso lo cubre token:gh ya). Hay que verificar
 * que el usuario tiene push access AL REMOTE de este proyecto.
 */
function createGhRemoteCheck({ projectDir }) {
  return {
    name: "project:gh-remote-access",
    label: "GitHub push access (current remote)",
    strategy: STRATEGY.MANUAL,
    applies: (config) => config?.git?.auto_pr === true,
    degradable: {
      disables: ["git.auto_pr"],
      warn: "auto_pr DESACTIVADO — no se pueden crear PRs al remote actual. Verifica permisos con `gh repo view`",
    },
    async detect() {
      // Verifica que el remote responde a ls-remote (read access mínimo,
      // proxy para push access — el push real solo se valida al pushear).
      try {
        const res = await runCommand("git", ["-C", projectDir, "ls-remote", "--heads", "origin"], { reject: false });
        if (res.exitCode === 0) {
          return { ok: true, severity: "info", detail: "Remote origin accesible vía git ls-remote" };
        }
        return {
          ok: false,
          severity: "warn",
          detail: `git ls-remote origin falló (exit ${res.exitCode}): ${(res.stderr || "").slice(0, 120)}`,
          fix: "Verifica el remote con `git remote -v` y la auth con `gh repo view`",
        };
      } catch (err) {
        return { ok: false, severity: "warn", detail: `git ls-remote error: ${err.message}`, fix: "Verifica git remote y auth gh" };
      }
    },
  };
}

/**
 * `kj init` ran check: si no existe ~/.karajan/kj.config.yml NI .karajan/coder-rules.md,
 * el usuario probablemente no ejecutó `kj init`. WARN con instrucción ejecutable.
 */
function createKjInitCheck({ projectDir }) {
  return {
    name: "project:kj-init-ran",
    label: "Karajan project initialized",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const projectKjFile = path.join(projectDir, ".karajan", "coder-rules.md");
      const globalKjFile = path.join(process.env.HOME || "", ".karajan", "kj.config.yml");
      if (fs.existsSync(projectKjFile) || fs.existsSync(globalKjFile)) {
        return { ok: true, severity: "info", detail: "Karajan config presente (global o local del proyecto)" };
      }
      return {
        ok: false,
        severity: "warn",
        detail: "No se encontró kj.config.yml global ni .karajan/coder-rules.md local — probablemente falta `kj init`",
        fix: "kj init",
      };
    },
  };
}

/**
 * Construye el set completo de project-aware checks basado en projectDir.
 *
 * @param {{ projectDir: string }} ctx
 * @returns {Check[]}
 */
export function getProjectChecks({ projectDir }) {
  if (!projectDir) return [];
  const signals = detectProjectSignals(projectDir);
  return [
    createKjInitCheck({ projectDir }),
    createWritePermsCheck({ projectDir }),
    createToolCheck({ signal: "docker", tool: "docker", label: "Docker (project signal)", signals }),
    createToolCheck({ signal: "firebase", tool: "firebase", label: "firebase-cli (project signal)", signals }),
    createToolCheck({ signal: "python", tool: "python3", label: "Python 3 (project signal)", signals }),
    createToolCheck({ signal: "rust", tool: "cargo", label: "Cargo / Rust (project signal)", signals }),
    createToolCheck({ signal: "go", tool: "go", label: "Go (project signal)", signals }),
    createToolCheck({ signal: "terraform", tool: "terraform", label: "Terraform (project signal)", signals }),
    createEnvConsistencyCheck({ projectDir, signals }),
    createGhRemoteCheck({ projectDir }),
  ];
}
