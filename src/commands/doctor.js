import { runCommand } from "../utils/process.js";

async function checkBinary(name, versionArg = "--version") {
  const res = await runCommand(name, [versionArg]);
  return { ok: res.exitCode === 0, output: res.stdout || res.stderr };
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
    console.log(`${result.ok ? "OK" : "MISS"} ${binary}: ${(result.output || "").split("\n")[0]}`);
  }

  console.log(`Review mode: ${config.review_mode}`);
  console.log(`Sonar profile: ${config.sonarqube.enforcement_profile}`);
}
