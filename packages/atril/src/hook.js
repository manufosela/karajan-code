/**
 * A cached plugin's command hooks (ADR 0021 decision 14, plan step 13d1-i). hookEntries lists
 * what hooks/hooks.json declares, in file order, each command with a content id from hookId: the
 * same id is the same execution, so a stale id fails instead of running another command. Other
 * handler types are reported as skipped, never dropped. Reading only, no process. `if` is not
 * evaluated here. Plugins in the Codex format and hooks declared in plugin.json are rejected.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isMapping, sortKeys } from "./model.js";
import { readJson, readPluginManifest } from "./plugin.js";

const HOOKS_FILE = join("hooks", "hooks.json");

// Only the fields that decide how the process runs: if, statusMessage and async do not count.
export const hookId = ({ command, args, shell, timeout }) =>
  createHash("sha256").update(JSON.stringify({ command, args, shell, timeout }, sortKeys)).digest("hex").slice(0, 12);

const must = (ok, file, place, message) => {
  if (!ok) throw new Error(`${file}: ${place ? `${place}: ` : ""}${message}`);
};

const checkCommand = (file, place, { command, args, timeout, shell }) => {
  must(typeof command === "string" && command !== "", file, place, "command must be a non-empty string");
  must(args === undefined || (Array.isArray(args) && args.every((arg) => typeof arg === "string")), file, place, "args must be a list of strings");
  must(timeout === undefined || (typeof timeout === "number" && timeout > 0), file, place, "timeout must be a positive number");
  must(shell !== "powershell", file, place, "shell powershell is not supported yet");
  must(shell === undefined || shell === "bash", file, place, `shell ${JSON.stringify(shell)} must be "bash"`);
};

export function hookEntries(dir) {
  const { format, manifest } = readPluginManifest(dir);
  if (format === "codex") throw new Error(`${dir}: .codex-plugin plugins are native-only`);
  if (manifest.hooks !== undefined) throw new Error(`${dir}: hooks declared in plugin.json are not supported yet`);
  const file = join(dir, HOOKS_FILE);
  const result = { hooks: [], skipped: [] };
  if (!existsSync(file)) return result;
  const parsed = readJson(file);
  must(isMapping(parsed), file, "", "must be an object");
  must(isMapping(parsed.hooks), file, "hooks", "must be an object");
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    must(Array.isArray(groups), file, `hooks.${event}`, "must be a list");
    groups.forEach((group, g) => {
      const at = `hooks.${event}[${g}]`;
      must(isMapping(group), file, at, "must be an object");
      must(group.matcher === undefined || typeof group.matcher === "string", file, at, "matcher must be a string");
      must(Array.isArray(group.hooks), file, `${at}.hooks`, "must be a list");
      group.hooks.forEach((handler, h) => {
        const place = `${at}.hooks[${h}]`;
        must(isMapping(handler), file, place, "must be an object");
        must(typeof handler.type === "string", file, place, "type must be a string");
        if (handler.type === "command") {
          checkCommand(file, place, handler);
          result.hooks.push({ id: hookId(handler), event, matcher: group.matcher, handler });
        } else {
          result.skipped.push({ event, matcher: group.matcher, type: handler.type, reason: "not a command hook" });
        }
      });
    });
  }
  return result;
}
