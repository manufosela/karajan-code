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
import { existsSync } from "node:fs";
import { join } from "node:path";

// KJC-BUG-0411 (#2563): uv and poetry keep pytest and ruff in the project's
// venv, where a bare command exits 127; their manager runs them.
const PYTHON_RUNNERS = [["uv.lock", "uv run"], ["poetry.lock", "poetry run"]];

export const COMMANDS_BY_LANGUAGE = {
  python: { lint: "ruff check .", format: "ruff format --check .", test: "pytest" },
  go: { lint: "go vet ./...", format: 'test -z "$(gofmt -l .)"', test: "go test ./..." },
  php: {
    lint: "vendor/bin/phpstan analyse --no-progress",
    format: "vendor/bin/php-cs-fixer fix --dry-run --diff",
    test: "vendor/bin/phpunit",
  },
};

// KJC-TSK-1237 (#2565): the formatter in write mode, run on the files of a session.
const FORMAT_WRITE_BY_LANGUAGE = {
  python: { command: "ruff format", extensions: [".py", ".pyi"] },
  go: { command: "gofmt -w", extensions: [".go"] },
  php: { command: "vendor/bin/php-cs-fixer fix", extensions: [".php"] },
};

const runnerFor = (language, projectDir) => (language === "python" && projectDir
  ? PYTHON_RUNNERS.find(([lock]) => existsSync(join(projectDir, lock)))?.[1] ?? null
  : null);

/** Native commands for a language, or {} when JS/TS or unknown; python ones through uv/poetry when the project uses them. */
export function commandsForLanguage(language, projectDir = null) {
  const cmds = { ...COMMANDS_BY_LANGUAGE[language] };
  const runner = runnerFor(language, projectDir);
  if (runner) for (const [step, command] of Object.entries(cmds)) cmds[step] = `${runner} ${command}`;
  return cmds;
}

/** The write-mode formatter of a language and the extensions it takes, or null. */
export function formatWriteFor(language, projectDir = null) {
  const entry = FORMAT_WRITE_BY_LANGUAGE[language];
  if (!entry) return null;
  return { ...entry, command: [runnerFor(language, projectDir), entry.command].filter(Boolean).join(" ") };
}
