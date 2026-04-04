import { exists } from "./fs.js";
import { runCommand } from "./process.js";
import path from "node:path";

export async function hasRulesync() {
  const projectRoot = process.cwd();
  return await exists(path.join(projectRoot, "rulesync.jsonc"));
}

async function getRulesyncBin() {
  const projectRoot = process.cwd();
  const localBin = path.join(projectRoot, "node_modules", ".bin", "rulesync");
  if (await exists(localBin)) {
    return localBin;
  }
  return "rulesync"; // Fallback to global if local not found
}

export async function syncRules(logger) {
  const nodeVersion = parseInt(process.versions.node.split(".")[0]);
  if (nodeVersion < 22) {
    logger.debug(`rulesync requires Node.js >= 22. Current version is ${nodeVersion}. Skipping sync.`);
    return false;
  }

  const bin = await getRulesyncBin();
  
  logger.info("Synchronizing AI agent rules with rulesync...");
  try {
    const result = await runCommand(bin, ["generate"]);
    if (result.ok) {
      logger.info("  OK   AI agent rules updated.");
      return true;
    }
    logger.warn(`  FAIL rulesync failed: ${result.stderr || result.stdout}`);
  } catch (err) {
    logger.warn(`  FAIL rulesync execution error: ${err.message}`);
  }
  return false;
}

async function checkRulesyncInstalled() {
  try {
    const bin = await getRulesyncBin();
    const result = await runCommand(bin, ["--version"]);
    return result.ok;
  } catch {
    return false;
  }
}
