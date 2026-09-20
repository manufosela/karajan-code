// Shared fixture for the review-gate suites (KJC-BUG-0192). Since an absent
// harness BLOCKS the review instead of standing down, any test that stages
// code must declare who recorded the session — the same thing a real project
// gets from `kj harden`. Installs the real Sentinel scripts (so they verify
// against the installed kj) and seeds a session that covers `files`.
import fs from "node:fs";
import path from "node:path";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

const quiet = { info() {}, warn() {} };

export function seedRagLedger(projectDir, files = [], sessionId = "s1") {
  installSentinelHooks({ projectDir, logger: quiet });
  const state = {
    sessions: {
      [sessionId]: { at: 1, rag_hits: [...files], rag_queries: files.map((f) => ({ text: `q ${f}`, hits: [f] })) },
    },
  };
  fs.writeFileSync(path.join(projectDir, ".karajan", "harness", "sentinel-state.json"), JSON.stringify(state));
}
