/**
 * `kj env install` (ENV-A1, KJC-TSK-0639) — install/refresh the Karajan
 * Environment playbook as a managed block in the host agents' rule files:
 * CLAUDE.md (Claude Code) and AGENTS.md (Codex), from one source.
 */
import { installPlaybook } from "../environment/playbook.js";

export async function envInstallCommand({ config = null, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const result = await installPlaybook({ projectDir, target: flags.target || "both" });
  console.log(`✓ Karajan playbook installed in: ${result.files.join(", ")}`);
  console.log("  The host agent now follows the method: RAG first, TDD, cross-AI review before commit.");
  return result;
}
