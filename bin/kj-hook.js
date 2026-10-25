#!/usr/bin/env node
/**
 * kj-hook <guard>: runs one Sentinel guard from the installed kj package
 * (KJC-TSK-1203, ADR 0030). The project's hooks name the guard; its code lives
 * here, outside the project tree, so editing the project cannot change it.
 * Only the guard is loaded, never the CLI: a hook pays node, not kj's start.
 * A name outside the closed list blocks (exit 2): a wiring that names no known
 * guard cannot be trusted to guard anything.
 */
import process from "node:process";
import { runGuard } from "../src/harden/sentinel-guards.js";

await runGuard(process.argv[2]);
