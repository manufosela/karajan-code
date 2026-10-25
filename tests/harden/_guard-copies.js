// KJC-TSK-1208 (ADR 0030): kj harden no longer copies the guards into the project;
// they run from the installed kj. The tests that exercise a guard's logic run it
// where the old install put it, byte for byte, with the record that install kept,
// so each copy finds its project two levels up exactly as before.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalHarnessBody } from "../../src/harden/sentinel-hooks.js";

const SENTINEL_GUARDS = [
  "sentinel-lib.mjs", "posttooluse.mjs", "stop.mjs", "pretooluse-sentinel.mjs", "sentinel-shell.mjs", "sentinel-discard.mjs",
  "sentinel-bash-write.mjs", "sentinel-reminders.mjs", "sessionstart.mjs", "sentinel-rules.mjs", "pretooluse-rules.mjs",
];

export function placeGuardCopies(dir) {
  const harness = path.join(dir, ".karajan", "harness");
  mkdirSync(harness, { recursive: true });
  const files = {};
  for (const name of SENTINEL_GUARDS) {
    const body = canonicalHarnessBody(name);
    writeFileSync(path.join(harness, name), body, { mode: 0o755 });
    files[name] = createHash("sha256").update(body).digest("hex");
  }
  writeFileSync(path.join(harness, "pretooluse.mjs"), canonicalHarnessBody("pretooluse.mjs"), { mode: 0o755 });
  writeFileSync(path.join(harness, "installed.json"), `${JSON.stringify({ files }, null, 2)}\n`);
}
