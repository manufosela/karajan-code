import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0146: the hero film loads a trimmed three.js bundle that exports only
// what the film uses. A THREE.X the bundle lacks would break the film in the
// browser and nowhere else, so this guard fails first.
const publicDir = new URL("../../apps/landing/public/", import.meta.url);
const bundle = readFileSync(new URL("lib/three.min.js", publicDir), "utf8");
const exported = new Set(
  [...bundle.matchAll(/export\{([^}]*)\}/g)]
    .flatMap(([, list]) => list.split(","))
    .map((entry) => entry.split(" as ").at(-1).trim())
);

const filmDir = new URL("film/", publicDir);
const filmSources = existsSync(filmDir)
  ? readdirSync(filmDir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(new URL(f, filmDir), "utf8"))
  : [];

const namesUsed = (source) => [
  ...[...source.matchAll(/\bTHREE\.([A-Za-z0-9_]+)/g)].map(([, name]) => name),
  ...[...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'three'/g)]
    .flatMap(([, list]) => list.split(","))
    .map((entry) => entry.split(" as ")[0].trim())
    .filter(Boolean),
];

describe("landing three.js bundle", () => {
  it("keeps the MIT licence banner", () => {
    expect(bundle).toMatch(/@license[\s\S]*SPDX-License-Identifier: MIT/);
  });

  it("exports the addons the film builds on", () => {
    for (const name of ["WebGLRenderer", "EffectComposer", "UnrealBloomPass", "RoundedBoxGeometry"]) {
      expect(exported).toContain(name);
    }
  });

  it("exports every three.js name the film uses", () => {
    const missing = filmSources.flatMap(namesUsed).filter((name) => !exported.has(name));
    expect(missing).toEqual([]);
  });
});
