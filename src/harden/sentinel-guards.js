/**
 * The Sentinel's guards as the hooks name them (KJC-TSK-1204, ADR 0030): one
 * closed list for both ways of running them from the installed package, the
 * kj-hook bin and `kj sentinel hook` (the single-file binary has no kj-hook).
 * Each entry loads only its module, so running a guard never pays the CLI.
 */
export const SENTINEL_GUARDS = {
  pretooluse: () => import("./sentinel/pretooluse.mjs"),
  "pretooluse-sentinel": () => import("./sentinel/pretooluse-sentinel.mjs"),
  "pretooluse-rules": () => import("./sentinel/pretooluse-rules.mjs"),
  posttooluse: () => import("./sentinel/posttooluse.mjs"),
  stop: () => import("./sentinel/stop.mjs"),
  sessionstart: () => import("./sentinel/sessionstart.mjs"),
};

/**
 * Run one guard: it reads the hook's input from stdin and exits on its own.
 * A name outside the list exits 2, because a wiring that names no known guard
 * cannot be trusted to guard anything.
 */
export async function runGuard(name, { logger = console, exit = (code) => process.exit(code) } = {}) {
  if (!Object.hasOwn(SENTINEL_GUARDS, name ?? "")) {
    logger.error(`kj-hook: "${name ?? ""}" is not a Sentinel guard (${Object.keys(SENTINEL_GUARDS).join(", ")}) — run kj harden to rewrite the wiring`);
    exit(2);
    return;
  }
  await SENTINEL_GUARDS[name]();
}
