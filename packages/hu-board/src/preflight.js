/**
 * Preflight checks for a project shown in the board.
 *
 * Goal: when a non-technical user opens a project on the board, they
 * should see at a glance "is this ready to run, or am I missing
 * something risky?" — every requirement listed with ✓ / ⚠ / ✗ and
 * the consequence of each missing item in plain language.
 *
 * The same data backs the pre-run safety modal: if the user clicks
 * ▶ Run plan / ▶ Run HU and any check returns `fail` (blocker) or
 * `warn` (risky but not fatal), we show a confirm dialog listing
 * what they're choosing to ignore. No silent surprises.
 *
 * The output is intentionally JSON-only so the front can render it
 * without parsing CLI output. Each check has:
 *   id          stable identifier for tests + UI hooks
 *   label       short Spanish label rendered next to the icon
 *   status      "ok" | "warn" | "fail" | "info"
 *   detail      short string describing what was found
 *   consequence what the user loses if status is warn/fail (plain
 *               Spanish, written for someone who is NOT a developer)
 *   blocking    true → run buttons require explicit confirm
 *
 * Lookups are non-blocking: if a CLI binary is not on PATH the
 * version check returns `warn` with a hint, never throws. The whole
 * endpoint must respond fast (< 500 ms) so the panel never blocks
 * the board UI.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getHuBoardPlansDirs } from './db.js';

function runQuiet(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 3000, ...opts });
    return { ok: true, out: out.trim() };
  } catch (err) {
    return { ok: false, err };
  }
}

function checkGitInit(projectDir) {
  const ok = existsSync(join(projectDir, '.git'));
  return ok
    ? { id: 'git_init', label: 'Git inicializado', status: 'ok', detail: '.git/ presente', blocking: false }
    : {
        id: 'git_init', label: 'Git inicializado', status: 'fail',
        detail: 'no se encontró .git/',
        consequence: 'Karajan no podrá crear ramas, commits ni PRs. La ejecución fallará en el primer paso.',
        blocking: true
      };
}

function checkGitRemote(projectDir) {
  const r = runQuiet(`git -C "${projectDir}" remote -v`);
  if (!r.ok) {
    return {
      id: 'git_remote', label: 'Repositorio remoto', status: 'fail',
      detail: 'git remote falló — ¿no es un repo git?',
      consequence: 'Sin remoto, no se podrán abrir Pull Requests entre roles ni colaborar con el reviewer remoto.',
      blocking: false
    };
  }
  if (!r.out) {
    return {
      id: 'git_remote', label: 'Repositorio remoto', status: 'warn',
      detail: 'no hay remote configurado',
      consequence: 'Karajan funcionará en local: hará commits pero no podrá abrir Pull Requests automáticos. El reviewer trabajará sobre tu copia local en lugar de un PR remoto. Para uso real, configura un remote (ej. `git remote add origin git@github.com:tu-user/tu-repo.git`).',
      blocking: false
    };
  }
  // Capture first remote URL for display.
  const firstLine = r.out.split('\n')[0] || '';
  const remoteUrl = firstLine.split(/\s+/)[1] || '(unknown)';
  return { id: 'git_remote', label: 'Repositorio remoto', status: 'ok', detail: remoteUrl, blocking: false };
}

function checkGitBranch(projectDir) {
  const r = runQuiet(`git -C "${projectDir}" rev-parse --abbrev-ref HEAD`);
  if (!r.ok) return { id: 'git_branch', label: 'Rama actual', status: 'info', detail: '(no disponible)', blocking: false };
  return { id: 'git_branch', label: 'Rama actual', status: 'info', detail: r.out, blocking: false };
}

function checkGitClean(projectDir) {
  const r = runQuiet(`git -C "${projectDir}" status --porcelain`);
  if (!r.ok) return { id: 'git_clean', label: 'Estado del working tree', status: 'info', detail: '(no disponible)', blocking: false };
  if (!r.out) return { id: 'git_clean', label: 'Working tree limpio', status: 'ok', detail: 'sin cambios pendientes', blocking: false };
  const count = r.out.split('\n').length;
  return {
    id: 'git_clean', label: 'Working tree con cambios', status: 'warn',
    detail: `${count} archivo(s) modificado(s)/sin trackear`,
    consequence: 'Karajan trabaja sobre tu copia actual. Si tienes cambios sin commitear, podrían mezclarse con los del coder y dificultar la revisión. Recomendado: commitea o stashéa antes de lanzar.',
    blocking: false
  };
}

function checkNodeVersion() {
  const v = process.version;                   // e.g. "v22.21.1"
  const major = Number(v.replace(/^v/, '').split('.')[0]);
  if (major >= 20) return { id: 'node_version', label: 'Node.js', status: 'ok', detail: v, blocking: false };
  return {
    id: 'node_version', label: 'Node.js', status: 'fail',
    detail: `${v} (se requiere ≥ 20)`,
    consequence: 'Las dependencias y los agentes asumen Node 20+. En versiones anteriores puede crashear sin mensaje claro.',
    blocking: true
  };
}

function checkKarajanVersion() {
  // Read package.json from the karajan-code repo this board ships in.
  // The board package lives at packages/hu-board/, so the parent
  // package.json is two levels up.
  const candidatePaths = [
    join(import.meta.dirname || '', '..', '..', '..', 'package.json'),
    join(process.cwd(), 'package.json'),
  ];
  for (const p of candidatePaths) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8'));
      if (pkg?.name === 'karajan-code' && pkg?.version) {
        return { id: 'kj_version', label: 'Karajan Code', status: 'ok', detail: `v${pkg.version}`, blocking: false };
      }
    } catch { /* keep trying */ }
  }
  return { id: 'kj_version', label: 'Karajan Code', status: 'info', detail: '(versión no detectada)', blocking: false };
}

const AGENT_BINS = [
  { id: 'agent_claude', bin: 'claude', label: 'Claude CLI', versionFlag: '--version' },
  { id: 'agent_codex',  bin: 'codex',  label: 'Codex CLI',  versionFlag: '--version' },
  { id: 'agent_gemini', bin: 'gemini', label: 'Gemini CLI', versionFlag: '--version' },
  { id: 'agent_aider',  bin: 'aider',  label: 'Aider',      versionFlag: '--version' },
];

/**
 * Returns the set of agent ids the user has explicitly declared in
 * their kj.config.yml. An agent that is missing from $PATH is only a
 * problem when it's declared (coder/reviewer/etc.); otherwise it's
 * just "not installed" — informational, not a warning.
 *
 * Reads the same yml the editor modal writes (~/.karajan/kj.config.yml).
 * Returns a Set of bin names ("claude", "codex", "gemini", "aider").
 */
function detectDeclaredAgents() {
  const declared = new Set();
  try {
    const home = process.env.KJ_HOME || process.env.HOME || '';
    // The yml lives in two possible locations depending on how the
    // user installed Karajan; check both for forwards-compat.
    const candidates = [join(home, '.karajan', 'kj.config.yml'), join(home, 'kj.config.yml')];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, 'utf8');
      // Don't pull in js-yaml just to read a few top-level keys —
      // a tolerant regex scan over `coder:` / `reviewer:` / `roles.X.provider:`
      // is enough and keeps preflight zero-dep.
      const topLevel = raw.match(/^(?:coder|reviewer|planner|architect|triage|researcher|tester|security|refactorer|impeccable)\s*:\s*([\w-]+)\s*$/gm) || [];
      for (const line of topLevel) {
        const m = /:\s*([\w-]+)\s*$/.exec(line);
        if (m) declared.add(m[1]);
      }
      const rolesProviders = raw.match(/^\s+provider\s*:\s*([\w-]+)\s*$/gm) || [];
      for (const line of rolesProviders) {
        const m = /:\s*([\w-]+)\s*$/.exec(line);
        if (m) declared.add(m[1]);
      }
      break;
    }
  } catch { /* config unreadable → declare nothing, every absence is just info */ }
  return declared;
}

/**
 * Check one agent CLI. Status semantics changed in PR-C:
 *
 *   - found on PATH         → "ok"   (✓, with version)
 *   - not on PATH, not used → "info" (gray, "(no instalado)")
 *   - not on PATH, declared → "warn" (yellow, with consequence)
 *
 * The user explicitly asked for this: missing Aider should NOT be a
 * warning when they don't use Aider. Only flag absence as a problem
 * when the kj.config.yml expects it.
 */
function checkAgent({ id, bin, label, versionFlag }, declaredAgents) {
  const which = runQuiet(`command -v ${bin}`);
  if (!which.ok) {
    if (declaredAgents.has(bin)) {
      return {
        id, label, status: 'warn',
        detail: 'declarado en kj.config.yml pero no encontrado en PATH',
        consequence: `Tu pipeline declara usar ${label.replace(' CLI', '')} pero el binario no está instalado. Las ejecuciones que lo invoquen fallarán. Instálalo o cambia el agente del rol en la configuración.`,
        blocking: false
      };
    }
    return {
      id, label, status: 'info',
      detail: 'no instalado',
      blocking: false
    };
  }
  const ver = runQuiet(`${bin} ${versionFlag}`);
  const vStr = ver.ok ? ver.out.split('\n')[0].trim() : '(versión desconocida)';
  return { id, label, status: 'ok', detail: vStr, blocking: false };
}

function checkConfigYml() {
  const home = process.env.KJ_HOME || process.env.HOME || '';
  const candidates = [join(home, '.karajan', 'kj.config.yml'), join(home, 'kj.config.yml')];
  for (const p of candidates) {
    if (existsSync(p)) {
      return { id: 'config_yml', label: 'Configuración global', status: 'ok', detail: p, blocking: false };
    }
  }
  return {
    id: 'config_yml', label: 'Configuración global', status: 'warn',
    detail: 'no se encontró ~/.karajan/kj.config.yml',
    consequence: 'Karajan usará valores por defecto. Funcionará, pero no podrás personalizar coder/reviewer/modelos.',
    blocking: false
  };
}

function checkPlans(projectId) {
  // KJC-BUG-0059 (v2.19.3): scan canonical + legacy roots, same as
  // the preflight route. Pre-fix this hard-coded `~/.kj/plans/`
  // missed every plan post-v2.19.0 → preflight reported "sin plans
  // aún" even when the user had a valid plan on disk.
  const dirs = getHuBoardPlansDirs().map((root) => join(root, projectId));
  const dir = dirs.find((d) => existsSync(d));
  if (!dir) {
    return {
      id: 'plans', label: 'Plans en disco', status: 'info',
      detail: 'sin plans aún',
      blocking: false
    };
  }
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    return { id: 'plans', label: 'Plans en disco', status: 'ok', detail: `${files.length} plan(s)`, blocking: false };
  } catch {
    return { id: 'plans', label: 'Plans en disco', status: 'info', detail: '(no se pudo leer)', blocking: false };
  }
}

/**
 * Run all preflight checks for a project.
 *
 * @param {object} args
 * @param {string} args.projectId - The board's project slug.
 * @param {string|null} args.projectDir - Absolute project path. When
 *   the project has no plan yet (or no projectDir stamped) we skip
 *   git-related checks instead of failing them — git state is only
 *   meaningful when we know which working copy to inspect.
 * @returns {Promise<{checks: object[], blockers: object[], warnings: object[]}>}
 */
export async function runPreflight({ projectId, projectDir }) {
  const checks = [];
  if (projectDir && existsSync(projectDir)) {
    checks.push(checkGitInit(projectDir));
    checks.push(checkGitRemote(projectDir));
    checks.push(checkGitBranch(projectDir));
    checks.push(checkGitClean(projectDir));
  } else {
    checks.push({
      id: 'project_dir', label: 'Directorio del proyecto', status: 'warn',
      detail: projectDir ? `no existe: ${projectDir}` : '(no detectado, abre un plan para que se registre)',
      consequence: 'Sin un directorio de proyecto válido, Karajan no sabe sobre qué trabajar.',
      blocking: !projectDir
    });
  }
  checks.push(checkNodeVersion());
  checks.push(checkKarajanVersion());
  // PR-C: agents are checked against the declared set in kj.config.yml.
  // Absent + undeclared → "info" (just informational, no warning sign).
  // Absent + declared   → "warn" (real problem: the pipeline can't run).
  const declaredAgents = detectDeclaredAgents();
  for (const a of AGENT_BINS) checks.push(checkAgent(a, declaredAgents));
  checks.push(checkConfigYml());
  checks.push(checkPlans(projectId));

  const blockers = checks.filter(c => c.status === 'fail' && c.blocking);
  const warnings = checks.filter(c => c.status === 'warn' || (c.status === 'fail' && !c.blocking));

  return { projectId, projectDir: projectDir || null, checks, blockers, warnings };
}
