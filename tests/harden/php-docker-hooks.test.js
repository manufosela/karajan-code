// HU-5069 (#5068): PHP stack commands follow the project's own tools, and never run on the host
// when the Makefile runs them in Docker.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveCmds } from "../../src/commands/harden.js";
import { formatWriteFor } from "../../src/harden/hook-commands.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-php-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (file, text = "") => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const composer = (json) => put("composer.json", JSON.stringify(json));

describe("PHP commands follow the project's tools", () => {
  it("a Pint project formats with pint, not php-cs-fixer", async () => {
    composer({ "require-dev": { "laravel/pint": "^1" } });
    expect(await resolveCmds(dir, "php")).toEqual({ format: "vendor/bin/pint --test" });
    expect(formatWriteFor("php", dir).command).toBe("vendor/bin/pint");
  });

  it("takes pint from its binary", async () => {
    put("vendor/bin/pint");
    expect((await resolveCmds(dir, "php")).format).toBe("vendor/bin/pint --test");
  });

  it.each([".php-cs-fixer.php", ".php-cs-fixer.dist.php"])("takes php-cs-fixer only with %s", async (file) => {
    put(file);
    expect((await resolveCmds(dir, "php")).format).toBe("vendor/bin/php-cs-fixer fix --dry-run --diff");
    expect(formatWriteFor("php", dir).command).toBe("vendor/bin/php-cs-fixer fix");
  });

  it("takes phpstan and phpunit from a requirement or a config file", async () => {
    composer({ require: { "phpstan/phpstan": "^1" } });
    put("phpunit.xml.dist");
    expect(await resolveCmds(dir, "php")).toEqual({ lint: "vendor/bin/phpstan analyse --no-progress", test: "vendor/bin/phpunit" });
    composer({ "require-dev": { "phpunit/phpunit": "^11" } });
    put("phpstan.neon.dist");
    expect(Object.keys(await resolveCmds(dir, "php"))).toEqual(["lint", "test"]);
  });

  it("the phpstan.neon kj seeds is no evidence, so a second harden writes the same hooks", async () => {
    put("phpstan.neon", "# >>> kj:managed:phpstan v1\nparameters:\n");
    expect(await resolveCmds(dir, "php")).toEqual({});
  });

  it("a PHP repo with no Makefile and no tools gets no php steps", async () => {
    composer({});
    expect(await resolveCmds(dir, "php")).toEqual({});
    expect(formatWriteFor("php", dir)).toBeNull();
  });
});

describe("a Makefile that runs its tools in Docker", () => {
  it.each(["docker compose exec", "docker-compose exec", "docker exec", "docker compose run", "docker compose -f ci.yml exec"])(
    "%s: no PHP command on the host", async (docker) => {
      composer({ "require-dev": { "laravel/pint": "^1" } });
      put("Makefile", `shell:\n\t${docker} app sh\nlint:\n\t@true\n`);
      expect(await resolveCmds(dir, "php")).toEqual({ lint: "make lint" });
      expect(formatWriteFor("php", dir)).toBeNull();
    });
});
