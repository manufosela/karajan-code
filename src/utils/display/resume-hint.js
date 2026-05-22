/**
 * Prints — as the LAST line of a stopped `kj run` / `kj plan` — the exact
 * command to resume it. A halted run that never tells you how to restart
 * it is the resilience gap this closes (resilience audit, Phase 1).
 *
 *   Quota hibernation → `kj standby resume <id>`
 *   Solomon pause     → `kj resume <id> --answer "..."`
 *   Stopped / failed  → `kj resume <id>`
 *   Success           → nothing.
 *
 * @param {object} result          - the flow / command result
 * @param {object} [opts]
 * @param {(line:string)=>void} [opts.print] - sink, default console.log
 */
export function printResumeHint(result, { print = console.log } = {}) {
  if (!result || typeof result !== "object") return;
  const id = result.sessionId || result.session?.id || null;

  if (result.hibernated === true) {
    print("");
    print("⏸  Run hibernated — provider quota exhausted.");
    print(`   Resume when the quota resets:  kj standby resume ${id || "<session-id>"}`);
    if (!id) print("   (run `kj standby list` to find the id)");
    return;
  }

  if (result.paused === true && id) {
    print("");
    print("⏸  Run paused — waiting for your input.");
    print(`   Resume:  kj resume ${id} --answer "<your answer>"`);
    return;
  }

  // Stopped / failed / aborted but with a session on record → resumable.
  // A successful run has approved === true and prints nothing.
  if (id && result.approved !== true && result.paused !== true) {
    print("");
    print("✗  Run stopped before finishing.");
    print(`   Resume:  kj resume ${id}`);
  }
}
