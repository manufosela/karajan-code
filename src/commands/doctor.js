import { runCommand } from "../utils/process.js";
import { resolveBin } from "../agents/resolve-bin.js";

async function checkBinary(name, versionArg = "--version") {
  const resolved = resolveBin(name);
  const res = await runCommand(resolved, [versionArg]);
  return { ok: res.exitCode === 0, output: res.stdout || res.stderr, path: resolved };
}

export async function doctorCommand({ config }) {
  const binaries = [
    ["node"],
    ["npm"],
    ["git"],
    ["docker"],
    ["claude"],
    ["codex"],
    ["gemini"],
    ["aider"]
  ];

  const results = [];
  for (const [binary] of binaries) {
    results.push([binary, await checkBinary(binary)]);
  }

  for (const [binary, result] of results) {
    const output = (result.output || "").split("\n")[0];
    console.log(`${result.ok ? "OK" : "MISS"} ${binary}: ${output} (${result.path})`);
  }

  console.log(`Review mode: ${config.review_mode}`);
  console.log(`Sonar profile: ${config.sonarqube.enforcement_profile}`);
}
