/**
 * Native lint/format/test commands per language for `kj harden` hooks
 * (KJC-TSK-0562).
 *
 * The installed hooks call the project's OWN toolchain, never npm by default,
 * so hardening a Go/Python repo never drags Node onto a contributor's machine.
 * JavaScript/TypeScript is built from package.json scripts by the caller (its
 * commands depend on what the project defines). Unknown language ⇒ no commands,
 * leaving only the universal POSIX-shell checks.
 */

export const COMMANDS_BY_LANGUAGE = {
  python: { lint: "ruff check .", format: "ruff format --check .", test: "pytest" },
  go: { lint: "go vet ./...", format: 'test -z "$(gofmt -l .)"', test: "go test ./..." },
};

/** Native commands for a language, or {} when JS/TS or unknown. */
export function commandsForLanguage(language) {
  return COMMANDS_BY_LANGUAGE[language] ?? {};
}
