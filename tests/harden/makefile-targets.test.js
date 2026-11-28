// KJC-TSK-1506 (ADR 0051, #3763): a project that wraps its tools in a Makefile (PHP inside Docker)
// gets `make <target>` in its hooks instead of the host commands detected for its stack.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveCmds } from "../../src/commands/harden.js";
import { makefileCommands, makefileRunsInDocker } from "../../src/harden/makefile-targets.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-makefile-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const makefile = (text, name = "Makefile") => writeFileSync(join(dir, name), text);

describe("makefileCommands (ADR 0051)", () => {
  it("maps lint plus analyse, test and format-check to make targets", () => {
    makefile(".PHONY: lint analyse test\nlint:\n\tdocker compose exec app composer lint\nanalyse: vendor\n\tdocker compose exec app composer analyse\ntest:\n\tdocker compose exec app composer test\nformat-check:\n\t@true\n");
    expect(makefileCommands(dir)).toEqual({ lint: "make lint && make analyse", test: "make test", format: "make format-check" });
  });

  it("takes analyze as well as analyse, and lint alone", () => {
    makefile("analyze:\n\t@true\n");
    expect(makefileCommands(dir)).toEqual({ lint: "make analyze" });
    makefile("lint:\n\t@true\n");
    expect(makefileCommands(dir)).toEqual({ lint: "make lint" });
  });

  it("reads every target of a rule that names several", () => {
    makefile(".PHONY: lint test\nlint test format-check: vendor\n\t@true\n");
    expect(makefileCommands(dir)).toEqual({ lint: "make lint", test: "make test", format: "make format-check" });
  });

  it("does not read a variable assignment as a target", () => {
    makefile("test := phpunit\nlint ::= x\nCC=gcc\n");
    expect(makefileCommands(dir)).toEqual({});
  });

  it("reads makefile and GNUmakefile too, and nothing without one", () => {
    expect(makefileCommands(dir)).toEqual({});
    makefile("test:\n\t@true\n", "GNUmakefile");
    expect(makefileCommands(dir)).toEqual({ test: "make test" });
  });
});

describe("makefileRunsInDocker counts only a recipe that executes docker (HU-5069)", () => {
  const runs = (line) => {
    makefile(`test:\n\t${line}\n`);
    return makefileRunsInDocker(dir);
  };

  it.each([
    '@echo "Use docker compose exec app sh"',
    "@echo docker compose exec app sh",
    "# docker compose exec app composer test",
    "printf '%s' 'docker exec app sh'",
    ": docker exec app sh",
  ])("not Docker: %s", (line) => {
    expect(runs(line)).toBe(false);
  });

  it.each([
    "@docker compose exec -T app vendor/bin/phpstan",
    "cd x && docker compose run --rm app composer test",
    '-+@ docker-compose -f "docker/compose.yml" run app composer test',
    "echo `docker exec app true`",
    "false || docker exec app composer test",
    "cat x | docker exec -i app sh",
    "V=$(docker compose exec -T app php -v)",
    "FOO=bar docker exec app cmd",
    "env FOO=bar docker compose exec app cmd",
    'echo "$(docker exec app true)"',
    'echo "php $$(cd $$(pwd) && docker compose exec -T app php -v)"',
    'echo "`docker exec app true`"',
    'echo "$(docker exec app sh -c "true")"',
    "echo starting && docker compose exec app composer test",
    "printf x; docker exec app true",
    "printf '%s' 'x && docker exec app sh'",
  ])("Docker: %s", (line) => {
    expect(runs(line)).toBe(true);
  });
});

describe("resolveCmds puts the Makefile targets over the stack's commands (ADR 0051)", () => {
  it("php: make targets where the Makefile has them, the detected command elsewhere", async () => {
    makefile("lint:\n\t@true\ntest:\n\t@true\n");
    writeFileSync(join(dir, ".php-cs-fixer.dist.php"), "");
    const cmds = await resolveCmds(dir, "php");
    expect(cmds.lint).toBe("make lint");
    expect(cmds.test).toBe("make test");
    expect(cmds.format).toBe("vendor/bin/php-cs-fixer fix --dry-run --diff");
  });

  it("javascript: a Makefile target beats the package.json script", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", test: "vitest run" } }));
    makefile("test:\n\t@true\n");
    const cmds = await resolveCmds(dir, "javascript");
    expect(cmds.test).toBe("make test");
    expect(cmds.lint).toBe("npm run -s lint");
  });
});
