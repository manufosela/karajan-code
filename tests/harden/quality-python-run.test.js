// HU-4831: uv sync and poetry install provision only what a lockfile project declares, so on a
// project that declares neither ruff nor pytest kj-quality has to add both to that environment itself.
// The generated steps run as a runner runs them, against fake pip, uv and poetry: an environment holds
// what the project declares (nothing here) plus what a step installs into it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import yaml from "js-yaml";
import { afterEach, beforeEach, expect, it } from "vitest";

import { installWorkflows } from "../../src/harden/workflow-engine.js";

// uv run and poetry run spawn the command from the manager's environment: one found outside it
// would not see the project's packages, so the fakes refuse it.
const FAKES = {
  // `pip install PKG...` or `python -m pip install PKG...`: each PKG comes from the index into this bin.
  python: `[ "$1" = -m ] && shift 2
[ "$1" = install ] || exit 2
shift
for pkg in "$@"; do cp "$FAKE_INDEX/$pkg" "$(dirname "$0")/" || exit 1; done`,
  // uv sync makes the project's .venv; uv run --with PKG... CMD adds each PKG to it, then spawns CMD.
  uv: `env="$(pwd)/.venv/bin"
case "$1" in
  sync) mkdir -p "$env" ;;
  run) shift
    while [ "$1" = --with ]; do cp "$FAKE_INDEX/$2" "$env/" || exit 1; shift 2; done
    [ -x "$env/$1" ] || { echo "error: Failed to spawn: $1" >&2; exit 2; }
    cmd=$1; shift; exec "$env/$cmd" "$@" ;;
  *) exit 2 ;;
esac`,
  // poetry install makes the project's venv with its own python; poetry run CMD spawns CMD from it.
  poetry: `env="$POETRY_VENV/bin"
case "$1" in
  install) mkdir -p "$env" && cp "$FAKE_INDEX/python" "$env/" ;;
  run) shift
    [ -x "$env/$1" ] || { echo "Command not found: $1" >&2; exit 1; }
    cmd=$1; shift; exec "$env/$cmd" "$@" ;;
  *) exit 2 ;;
esac`,
  // The checks only say where they ran from.
  ruff: 'echo "$0" "$@" >> "$FAKE_LOG"',
  pytest: 'echo "$0" "$@" >> "$FAKE_LOG"',
};

let world;
beforeEach(() => {
  world = realpathSync(mkdtempSync(join(tmpdir(), "kj-pyrun-")));
});
afterEach(() => rmSync(world, { recursive: true, force: true }));

// The runner after setup-python: the fake index, a bin on the PATH holding pip, and the project.
function fakeRunner() {
  const dirs = { index: join(world, "index"), bin: join(world, "runner-bin"), project: join(world, "project") };
  for (const dir of Object.values(dirs)) mkdirSync(dir);
  for (const [name, body] of Object.entries(FAKES)) writeFileSync(join(dirs.index, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  writeFileSync(join(dirs.bin, "pip"), `#!/bin/sh\n${FAKES.python}\n`, { mode: 0o755 });
  return dirs;
}

it.each([
  ["uv", "uv.lock", ["project", ".venv", "bin"]],
  ["poetry", "poetry.lock", ["poetry-venv", "bin"]],
])("a %s project that declares neither ruff nor pytest gets both in its environment, and runs them there", (_tool, lock, envPath) => {
  const { index, bin, project } = fakeRunner();
  writeFileSync(join(project, lock), "");
  writeFileSync(join(project, "pyproject.toml"), "[project]\nname = 'demo'\ndependencies = ['requests']\n");
  installWorkflows({ projectDir: project, language: "python" });
  const log = join(world, "checks.log");
  const env = { PATH: `${bin}:/usr/bin:/bin`, FAKE_INDEX: index, FAKE_LOG: log, POETRY_VENV: join(world, "poetry-venv") };
  const { steps } = yaml.load(readFileSync(join(project, ".github", "workflows", "kj-quality.yml"), "utf8")).jobs.quality;
  for (const { run } of steps.filter((step) => step.run)) {
    // The shell GitHub runs a step with: no profile or rc file of whoever runs the suite.
    const res = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", run], { cwd: project, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    expect(res.status, `${run}: ${res.stderr}`).toBe(0);
  }
  const envBin = join(world, ...envPath);
  expect(readFileSync(log, "utf8").split("\n").filter(Boolean)).toEqual([`${join(envBin, "ruff")} check .`, join(envBin, "pytest")]);
});
