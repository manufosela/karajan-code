/**
 * `kj atril [args...]` (HU-4441): a proxy to atril's own CLI. kj does not read
 * atril's arguments, so every command atril grows reaches it without touching kj.
 */
import { runAtril } from "../skills/atril-cli.js";

/** The raw arguments after the first `atril` token: commander must not eat `--` or options. */
export function rawAtrilArgs(argv) {
  const at = argv.indexOf("atril");
  return at === -1 ? [] : argv.slice(at + 1);
}

/** Runs atril with exactly the person's arguments; returns atril's exit code. */
export function atrilCommand({ args = [], ...deps }) {
  const [action, ...rest] = args;
  return runAtril({ action, args: rest, ...deps });
}
