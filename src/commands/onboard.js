// KJC-TSK-0384 PR 2 — `kj onboard` runs collectors + optional LLM synth.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { collectAll } from "../onboarder/collectors/index.js";
import { OnboarderRole } from "../roles/onboarder-role.js";
import { resolveRole } from "../config.js";
import { getKarajanHome } from "../utils/paths.js";

export function briefPath(projectDir) {
  const slug = path.basename(projectDir).replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase() || "project";
  return path.join(getKarajanHome(), "onboarding", `${slug}.md`);
}

export async function onboardCommand({ config, logger, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const out = flags.output || briefPath(projectDir);
  logger.info(`[onboard] collecting from ${projectDir}`);
  const bundle = await collectAll(projectDir);
  await mkdir(path.dirname(out), { recursive: true });
  if (flags.noSynth) {
    await writeFile(out, `# Onboarding bundle — ${projectDir}\n\n\`\`\`json\n${JSON.stringify(bundle, null, 2)}\n\`\`\`\n`, "utf8");
    logger.info(`[onboard] wrote raw bundle to ${out} (--no-synth)`);
    return { path: out, bundle, brief: null };
  }
  const roleCfg = resolveRole(config, "onboarder") || resolveRole(config, "architect");
  const templatePath = new URL("../../templates/roles/onboarder.md", import.meta.url).pathname;
  const instructions = existsSync(templatePath) ? await readFile(templatePath, "utf8") : "";
  const role = new OnboarderRole({ instructions, config, ...roleCfg });
  const result = await role.run({ bundle });
  const brief = result?.result?.brief || "# Project is greenfield\n\nNo synth output.\n";
  await writeFile(out, brief, "utf8");
  logger.info(`[onboard] wrote Architecture Brief to ${out}`);
  return { path: out, bundle, brief };
}
