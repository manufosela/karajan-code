/**
 * Compatibility shim for `--reporter=basic`.
 *
 * Vitest 4 dropped the built-in `basic` reporter (its behaviour is now the
 * same as the default reporter at silent verbosity). The FASE 2 acceptance
 * gate runs `npm test -- --reporter=basic`, so we expose a thin alias here
 * and wire it into `vitest.config.js` via `resolve.alias`.
 *
 * The module re-exports the built-in `DotReporter` as the default export,
 * which produces a single character per test plus the final summary — the
 * closest match to the old basic output and enough for the gate's
 * `pass(ed)?` grep.
 */
import { DotReporter } from "vitest/node";

export default DotReporter;
