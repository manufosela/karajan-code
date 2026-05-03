/**
 * CI infrastructure checks: required workflows, gh CLI, and GitHub secrets.
 * Only applies when `config.ci.enabled === true`.
 */

import path from "node:path";
import { exists } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";
import { checkBinary } from "../utils/agent-detect.js";
import { STRATEGY } from "./types.js";

const REQUIRED_WORKFLOWS = ["kj-ci-gateway.yml", "automerge.yml", "houston-override.yml"];

function ciEnabled(config) {
  return config.ci?.enabled === true;
}

function createWorkflowCheck(workflow) {
  return {
    name: `ci:workflow:${workflow}`,
    label: `CI workflow: ${workflow}`,
    strategy: STRATEGY.MANUAL,
    applies: ciEnabled,
    async detect({ config }) {
      const projectDir = config.projectDir || process.cwd();
      const wfPath = path.join(projectDir, ".github", "workflows", workflow);
      const wfExists = await exists(wfPath);
      return {
        ok: wfExists,
        severity: "fail",
        detail: wfExists ? "Found" : "Not found",
        fix: wfExists
          ? undefined
          : `Run 'kj init --scaffold-ci' or copy from karajan-code/templates/workflows/${workflow}`,
      };
    },
  };
}

function createGhCliCheck() {
  return {
    name: "ci:gh",
    label: "CI: gh CLI",
    strategy: STRATEGY.MANUAL,
    applies: ciEnabled,
    async detect() {
      const gh = await checkBinary("gh");
      return {
        ok: gh.ok,
        severity: "fail",
        detail: gh.ok ? gh.version : "Not found",
        fix: gh.ok ? undefined : "Install GitHub CLI: https://cli.github.com/",
      };
    },
  };
}

function createGhSecretsCheck() {
  return {
    name: "ci:secrets",
    label: "CI: GitHub secrets",
    strategy: STRATEGY.MANUAL,
    applies: ciEnabled,
    async detect() {
      try {
        const { detectRepo } = await import("../ci/repo.js");
        const repo = await detectRepo();
        if (!repo) {
          return { ok: true, severity: "info", detail: "No GitHub repo detected (skipped)" };
        }
        const res = await runCommand("gh", ["api", `repos/${repo}/actions/secrets`, "--jq", ".secrets[].name"]);
        if (res.exitCode !== 0) {
          return { ok: true, severity: "info", detail: "Cannot query secrets (gh unauthenticated?)" };
        }
        const names = new Set(res.stdout.split("\n").map((s) => s.trim()));
        const hasAppId = names.has("KJ_CI_APP_ID");
        const hasKey = names.has("KJ_CI_PRIVATE_KEY");
        const secretsOk = hasAppId && hasKey;
        const missing = [!hasAppId && "KJ_CI_APP_ID", !hasKey && "KJ_CI_PRIVATE_KEY"].filter(Boolean).join(" ");
        return {
          ok: secretsOk,
          severity: "fail",
          detail: secretsOk ? "KJ_CI_APP_ID + KJ_CI_PRIVATE_KEY found" : `Missing: ${missing}`,
          fix: secretsOk ? undefined : "Add KJ_CI_APP_ID and KJ_CI_PRIVATE_KEY as GitHub repository secrets",
        };
      } catch {
        return { ok: true, severity: "info", detail: "Cannot check secrets (unexpected error, skipped)" };
      }
    },
  };
}

/**
 * Aggregate of CI checks. Each check carries its own `applies` so the runner
 * marks them SKIPPED when CI is disabled.
 */
export function getCiChecks() {
  const checks = [];
  for (const wf of REQUIRED_WORKFLOWS) {
    checks.push(createWorkflowCheck(wf));
  }
  checks.push(createGhCliCheck());
  checks.push(createGhSecretsCheck());
  return checks;
}
