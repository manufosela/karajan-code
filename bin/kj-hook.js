#!/usr/bin/env node
/**
 * kj-hook <guard>: runs one Sentinel guard from the installed kj package
 * (KJC-TSK-1203, ADR 0030). The project's hooks name the guard; its code lives
 * here, outside the project tree, so editing the project cannot change it.
 * Only the guard is loaded, never the CLI: a hook pays node, not kj's start.
 * A name outside the closed list blocks (exit 2): a wiring that names no known
 * guard cannot be trusted to guard anything.
 */
import console from "node:console";
import process from "node:process";

const GUARDS = {
  "pretooluse-sentinel": () => import("../src/harden/sentinel/pretooluse-sentinel.mjs"),
  "pretooluse-rules": () => import("../src/harden/sentinel/pretooluse-rules.mjs"),
  posttooluse: () => import("../src/harden/sentinel/posttooluse.mjs"),
  stop: () => import("../src/harden/sentinel/stop.mjs"),
  sessionstart: () => import("../src/harden/sentinel/sessionstart.mjs"),
};

const name = process.argv[2] ?? "";
if (!Object.hasOwn(GUARDS, name)) {
  console.error(`kj-hook: "${name}" is not a Sentinel guard (${Object.keys(GUARDS).join(", ")}) — run kj harden to rewrite the wiring`);
  process.exit(2);
}
await GUARDS[name]();
