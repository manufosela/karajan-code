/**
 * KJC-TSK-1506 (ADR 0051, #3763): a project that wraps its tools in a Makefile (PHP inside
 * Docker, say) runs them with `make <target>`. Those targets are its own interface, so the
 * hooks use them over the commands detected for the stack: lint (plus analyse or analyze),
 * test and format-check. Only the root Makefile counts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// GNU make's own search order.
const MAKEFILES = ["GNUmakefile", "makefile", "Makefile"];
// A rule line `name:`, `a b c:` or `name: deps`; `name := x` and `name ::= x` are variables,
// and special targets such as `.PHONY` start with a dot, so neither is read as a target.
const NAME = String.raw`[A-Za-z0-9][\w.-]*`;
const RULE = new RegExp(String.raw`^(${NAME}(?:[ \t]+${NAME})*)[ \t]*:(?![:=])`);

/** The targets the project's root Makefile defines (the first one make itself would read). */
export function makefileTargets(projectDir) {
  const file = MAKEFILES.map((name) => join(projectDir, name)).find((path) => existsSync(path));
  if (!file) return new Set();
  const rules = readFileSync(file, "utf8").split("\n").map((line) => RULE.exec(line)?.[1]).filter(Boolean);
  return new Set(rules.flatMap((rule) => rule.split(/[ \t]+/)));
}

/** The hook commands the Makefile gives, by step; a step it has no target for is left out. */
export function makefileCommands(projectDir) {
  const targets = makefileTargets(projectDir);
  const make = (...names) => names.filter((n) => targets.has(n)).map((n) => `make ${n}`);
  const lint = make("lint", targets.has("analyse") ? "analyse" : "analyze");
  const format = make("format-check");
  const test = make("test");
  return {
    ...(lint.length > 0 ? { lint: lint.join(" && ") } : {}),
    ...(format.length > 0 ? { format: format[0] } : {}),
    ...(test.length > 0 ? { test: test[0] } : {}),
  };
}
