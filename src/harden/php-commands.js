/**
 * HU-5069 (#5068): the PHP commands `kj harden` writes, only for the tools the project has
 * (its composer.json or their own files). Every file is read as text; nothing is executed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const has = (dir, ...files) => files.some((file) => existsSync(join(dir, file)));

function requirements(dir) {
  try {
    const composer = JSON.parse(readFileSync(join(dir, "composer.json"), "utf8"));
    return { ...composer.require, ...composer["require-dev"] };
  } catch {
    return {}; // no readable composer.json: only the tools' own files count
  }
}

// The phpstan.neon kj seeds is not the project's choice: counting it would change the hooks on a second run.
const ownPhpstanConfig = (dir) => ["phpstan.neon", "phpstan.neon.dist"]
  .some((file) => has(dir, file) && !readFileSync(join(dir, file), "utf8").includes("kj:managed:phpstan"));

/** The project's formatter: Pint, else php-cs-fixer when it is configured, else null. */
function formatter(dir) {
  if (requirements(dir)["laravel/pint"] || has(dir, "vendor/bin/pint")) {
    return { check: "vendor/bin/pint --test", write: "vendor/bin/pint" };
  }
  if (!has(dir, ".php-cs-fixer.php", ".php-cs-fixer.dist.php")) return null;
  return { check: "vendor/bin/php-cs-fixer fix --dry-run --diff", write: "vendor/bin/php-cs-fixer fix" };
}

/** The lint/format/test commands of a PHP root; a step with no tool is left out. */
export function phpCommands(dir) {
  const required = requirements(dir);
  const lint = required["phpstan/phpstan"] || ownPhpstanConfig(dir);
  const test = required["phpunit/phpunit"] || has(dir, "phpunit.xml", "phpunit.xml.dist");
  const format = formatter(dir)?.check;
  return {
    ...(lint ? { lint: "vendor/bin/phpstan analyse --no-progress" } : {}),
    ...(format ? { format } : {}),
    ...(test ? { test: "vendor/bin/phpunit" } : {}),
  };
}

/** The write-mode command of the project's formatter, or null. */
export const phpFormatWrite = (dir) => formatter(dir)?.write ?? null;
