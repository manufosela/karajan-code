#!/usr/bin/env node
// kj sentinel rules hook (KJC-TSK-0946, MDR-C2, ADR 0016), managed by `kj harden`.
// PreToolUse with NO matcher: every tool call, MCP ones included, passes the rules
// of the MD files (compiled into .karajan/rules.yml) before it runs. Exit 2 blocks
// the call and stderr says which rule. The decision is the gate's (sentinel-rules.mjs).
// Copied byte for byte into .karajan/harness.
import console from "node:console";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { ROOT, doc } from "./sentinel-lib.mjs";
import { rulesGate } from "./sentinel-rules.mjs";

let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  let call;
  try { call = JSON.parse(raw); } catch { process.exit(0); } // not a tool call: nothing to judge
  // The user's switch for the whole Sentinel, set in the host's environment.
  if (process.env.KJ_SENTINEL_OFF === "1") process.exit(0);
  const verdict = rulesGate({ root: ROOT, tool: call?.tool_name, input: call?.tool_input, run: spawnSync });
  if (!verdict.deny) process.exit(0);
  console.error("karajan sentinel: " + verdict.message + doc("rules"));
  console.error("karajan: Karajan gobierna y se le obedece. No rodees el gate ni cambies la regla para pasarlo; si te parece injusta, díselo a tu usuario o usa kj report-issue.");
  process.exit(2);
});
