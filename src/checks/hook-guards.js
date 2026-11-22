/**
 * HU-4795: a hook that runs `kj-hook <guard>` blocks every call when the kj-hook on the PATH is older
 * than the wiring and does not know that guard (it exits 2). kj doctor asks the installed kj-hook which
 * guards it knows (it lists them when refusing a name that is none) and names the wired ones it lacks.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { kjHookOnPath, LOCAL_SETTINGS, SHARED_SETTINGS } from "../harden/harness-hooks.js";
import { GUARD_PROBE, guardsFromRefusal } from "../harden/sentinel-guards.js";
import { STRATEGY } from "./types.js";

const FIX = "update kj so kj-hook knows them, or run `kj harden` to rewrite the wiring";
const KJ_HOOK_CALL = /\bkj-hook ([\w-]+)/g;
const PROBE_TIMEOUT_MS = 10_000;

const probeKjHook = () => spawnSync("kj-hook", [GUARD_PROBE], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: PROBE_TIMEOUT_MS });

/** Every `kj-hook <name>` the hook commands of both settings files run, with its file and event. */
function wiredGuards(projectDir) {
  const wired = [];
  for (const file of [LOCAL_SETTINGS, SHARED_SETTINGS]) {
    let hooks;
    try { hooks = JSON.parse(readFileSync(join(projectDir, file), "utf8"))?.hooks; } catch { continue; }
    for (const [event, list] of Object.entries(hooks && typeof hooks === "object" ? hooks : {})) {
      for (const entry of Array.isArray(list) ? list : []) {
        for (const { command } of Array.isArray(entry?.hooks) ? entry.hooks : []) {
          for (const [, name] of String(command ?? "").matchAll(KJ_HOOK_CALL)) wired.push({ file: file.split(sep).join("/"), event, name });
        }
      }
    }
  }
  return wired;
}

export function getHookGuardChecks(config) {
  const onPath = config?.onPath ?? kjHookOnPath;
  const probe = config?.probe ?? probeKjHook;
  return [{
    name: "hook-guards",
    label: "Guards the installed kj-hook knows",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const wired = wiredGuards(config?.projectDir || process.cwd());
      if (wired.length === 0) return { ok: true, severity: "info", detail: "no hook runs kj-hook" };
      if (!onPath()) return { ok: true, severity: "info", detail: "kj-hook is not on the PATH, the hooks run through kj" };
      const known = guardsFromRefusal(probe().stderr);
      if (!known) return { ok: false, severity: "fail", detail: "cannot read the guards of the installed kj-hook", fix: FIX };
      const missing = wired.filter(({ name }) => !known.includes(name));
      if (missing.length === 0) return { ok: true, severity: "info", detail: "the installed kj-hook knows every wired guard" };
      const detail = missing.map(({ file, event, name }) => `${file} ${event} → kj-hook ${name}`).join("; ");
      return { ok: false, severity: "fail", detail, fix: FIX };
    },
  }];
}
