// Shim: process runner now lives in @karajan/core/process so the
// hu-board workspace can consume it without a relative dep on the CLI
// src tree. KJC-TSK-0511 PR6.
export { runCommand } from "@karajan/core/process";
