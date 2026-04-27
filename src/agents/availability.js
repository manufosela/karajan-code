import { runCommand } from "../utils/process.js";
import { resolveBin } from "./resolve-bin.js";
import { getAgentMeta } from "./index.js";

export async function assertAgentsAvailable(agentNames = []) {
  const unique = [...new Set(agentNames.filter(Boolean))];

  // PR-J (audit quick win): probe every agent CLI in parallel via
  // Promise.all instead of awaiting in a for-of loop. Each probe is
  // an independent fork+exec with no shared state, so serialising
  // them was wasted preflight latency: O(n) shell-outs becomes O(1)
  // (max of all probes). On 4 agents at ~80ms each this drops the
  // wait from ~320ms to ~80ms.
  const probes = await Promise.all(
    unique.map(async (name) => {
      const meta = getAgentMeta(name);
      if (!meta?.bin) return null;
      const res = await runCommand(resolveBin(meta.bin), ["--version"]);
      return res.exitCode !== 0 ? { name, ...meta } : null;
    })
  );
  const missing = probes.filter(Boolean);

  if (missing.length === 0) return;

  const lines = ["Missing required AI CLIs for this command:"];
  for (const m of missing) {
    lines.push(`- ${m.name}: command '${m.bin}' not found`, `  Install: ${m.installUrl}`);
  }
  throw new Error(lines.join("\n"));
}
