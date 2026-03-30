import fs from "node:fs/promises";
import { resolveRoleMdPath, loadFirstExisting } from "../roles/base-role.js";
import { resolveRole } from "../config.js";
import { exists } from "../utils/fs.js";

const PIPELINE_ROLES = [
  { name: "triage", description: "Classifies task complexity and activates pipeline roles" },
  { name: "researcher", description: "Investigates codebase before planning" },
  { name: "planner", description: "Generates implementation plans" },
  { name: "coder", description: "Writes code and tests (TDD)" },
  { name: "refactorer", description: "Improves code clarity without changing behavior" },
  { name: "sonar", description: "SonarQube static analysis" },
  { name: "reviewer", description: "Code review with configurable strictness" },
  { name: "tester", description: "Test quality gate and coverage checks" },
  { name: "security", description: "OWASP security audit" },
  { name: "solomon", description: "Conflict resolver between agents" },
  { name: "commiter", description: "Git commit, push, and PR automation" }
];

const REVIEW_VARIANTS = ["reviewer-strict", "reviewer-relaxed", "reviewer-paranoid"];

function isRoleEnabled(config, roleName) {
  if (roleName === "coder" || roleName === "commiter" || roleName === "sonar") {
    if (roleName === "sonar") return Boolean(config?.sonarqube?.enabled);
    return true;
  }
  if (roleName === "reviewer") return config?.pipeline?.reviewer?.enabled !== false;
  return Boolean(config?.pipeline?.[roleName]?.enabled);
}

export function listRoles(config) {
  return PIPELINE_ROLES.map((role) => {
    const resolved = resolveRole(config, role.name);
    return {
      name: role.name,
      description: role.description,
      provider: resolved.provider || "-",
      model: resolved.model || "-",
      enabled: isRoleEnabled(config, role.name)
    };
  });
}

export async function showRole(roleName, config) {
  const projectDir = config?.projectDir || process.cwd();
  const candidates = resolveRoleMdPath(roleName, projectDir);

  const customPath = candidates[0];
  const hasCustom = await exists(customPath);

  const content = await loadFirstExisting(candidates);
  if (!content) {
    return { found: false, roleName, content: null, source: null, customPath: null };
  }

  let source = "built-in";
  if (hasCustom) {
    source = "custom";
  } else if (candidates.length > 2) {
    try {
      await fs.readFile(candidates[1], "utf8");
      source = "user";
    } catch { /* user role file not found */
      source = "built-in";
    }
  }

  return {
    found: true,
    roleName,
    content,
    source,
    customPath: hasCustom ? customPath : null
  };
}

function printRoleList(roles) {
  const nameWidth = Math.max(...roles.map((r) => r.name.length), 4);
  const provWidth = Math.max(...roles.map((r) => r.provider.length), 8);

  const header = `${"Role".padEnd(nameWidth)}  ${"Provider".padEnd(provWidth)}  Enabled  Description`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (const role of roles) {
    const enabled = role.enabled ? "yes" : "no ";
    console.log(
      `${role.name.padEnd(nameWidth)}  ${role.provider.padEnd(provWidth)}  ${enabled.padEnd(7)}  ${role.description}`
    );
  }
}

export async function rolesCommand({ config, subcommand, roleName }) {
  if (subcommand === "show" && roleName) {
    const result = await showRole(roleName, config);
    if (!result.found) {
      console.log(`Role "${roleName}" not found.`);
      console.log(`Available roles: ${PIPELINE_ROLES.map((r) => r.name).join(", ")}`);
      console.log(`Review variants: ${REVIEW_VARIANTS.join(", ")}`);
      return result;
    }
    if (result.source === "custom") {
      console.log(`[custom override: ${result.customPath}]\n`);
    }
    console.log(result.content);
    return result;
  }

  const roles = listRoles(config);
  printRoleList(roles);
  console.log(`\nReview variants: ${REVIEW_VARIANTS.join(", ")}`);
  console.log('\nUse "kj roles show <role>" to view template instructions.');
  return roles;
}

export { PIPELINE_ROLES, REVIEW_VARIANTS };
