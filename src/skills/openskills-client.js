/**
 * OpenSkills CLI client.
 * Wraps `npx openskills` commands for installing, removing, listing, and reading skills.
 */

import { runCommand } from "../utils/process.js";

const NPX = "npx";
const PKG = "openskills";

function buildCwd(projectDir) {
  return projectDir || process.cwd();
}

/**
 * Check whether the openskills CLI is available.
 * @returns {Promise<boolean>}
 */
export async function isOpenSkillsAvailable() {
  try {
    const result = await runCommand(NPX, [PKG, "--version"], {
      timeout: 15_000
    });
    return result.exitCode === 0;
  } catch { /* openskills CLI not available */
    return false;
  }
}

/**
 * Install a skill from a marketplace name, GitHub URL, or local path.
 * @param {string} source - Skill source identifier.
 * @param {object} opts
 * @param {string} [opts.projectDir] - Working directory.
 * @param {boolean} [opts.global] - Install globally (~/.agent/skills/).
 * @returns {Promise<{ok: boolean, name?: string, error?: string}>}
 */
export async function installSkill(source, { projectDir, global: isGlobal } = {}) {
  if (!source) {
    return { ok: false, error: "source is required for install" };
  }

  const args = [PKG, "install", source];
  if (isGlobal) args.push("--global");

  const result = await runCommand(NPX, args, {
    cwd: buildCwd(projectDir),
    timeout: 60_000
  });

  if (result.exitCode !== 0) {
    const stderr = (result.stderr || "").trim();
    return { ok: false, error: stderr || `install failed (exit ${result.exitCode})` };
  }

  // Try to extract the skill name from stdout
  const output = (result.stdout || "").trim();
  const nameMatch = output.match(/installed\s+(?:skill\s+)?["']?([^\s"']+)["']?/i)
    || output.match(/([^\s/]+)\s*$/);
  const name = nameMatch ? nameMatch[1] : source;

  return { ok: true, name };
}

/**
 * Remove an installed skill by name.
 * @param {string} name - Skill name.
 * @param {object} opts
 * @param {string} [opts.projectDir] - Working directory.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function removeSkill(name, { projectDir } = {}) {
  if (!name) {
    return { ok: false, error: "name is required for remove" };
  }

  const result = await runCommand(NPX, [PKG, "remove", name], {
    cwd: buildCwd(projectDir),
    timeout: 30_000
  });

  if (result.exitCode !== 0) {
    const stderr = (result.stderr || "").trim();
    return { ok: false, error: stderr || `remove failed (exit ${result.exitCode})` };
  }

  return { ok: true };
}

/**
 * List installed skills.
 * @param {object} opts
 * @param {string} [opts.projectDir] - Working directory.
 * @returns {Promise<{ok: boolean, skills?: Array<{name: string, source?: string, scope?: string}>, error?: string}>}
 */
export async function listSkills({ projectDir } = {}) {
  const result = await runCommand(NPX, [PKG, "list", "--json"], {
    cwd: buildCwd(projectDir),
    timeout: 30_000
  });

  if (result.exitCode !== 0) {
    // Fallback: try without --json
    const fallback = await runCommand(NPX, [PKG, "list"], {
      cwd: buildCwd(projectDir),
      timeout: 30_000
    });

    if (fallback.exitCode !== 0) {
      const stderr = (fallback.stderr || "").trim();
      return { ok: false, error: stderr || `list failed (exit ${fallback.exitCode})` };
    }

    // Parse text output: each line is a skill name
    const lines = (fallback.stdout || "").split("\n").map(l => l.trim()).filter(Boolean);
    const skills = lines.map(line => ({ name: line }));
    return { ok: true, skills };
  }

  // Parse JSON output
  const stdout = (result.stdout || "").trim();
  try {
    const parsed = JSON.parse(stdout);
    const skills = Array.isArray(parsed) ? parsed : (parsed.skills || []);
    return { ok: true, skills };
  } catch {
    // If JSON parse fails, treat as text
    const lines = stdout.split("\n").map(l => l.trim()).filter(Boolean);
    const skills = lines.map(line => ({ name: line }));
    return { ok: true, skills };
  }
}

/**
 * Read a skill's content by name.
 * @param {string} name - Skill name.
 * @param {object} opts
 * @param {string} [opts.projectDir] - Working directory.
 * @returns {Promise<{ok: boolean, content?: string, error?: string}>}
 */
export async function readSkill(name, { projectDir } = {}) {
  if (!name) {
    return { ok: false, error: "name is required for read" };
  }

  const result = await runCommand(NPX, [PKG, "read", name], {
    cwd: buildCwd(projectDir),
    timeout: 30_000
  });

  if (result.exitCode !== 0) {
    const stderr = (result.stderr || "").trim();
    return { ok: false, error: stderr || `read failed (exit ${result.exitCode})` };
  }

  return { ok: true, content: (result.stdout || "").trim() };
}
