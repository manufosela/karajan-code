// @karajan/ai-trash — public entry (skeleton).
// Real surface (snapshot, restore, list, manifest) lands in KJC-TSK-0388
// commits 2-6 and KJC-TSK-0389 (git ops). For now we expose a single
// `version` export so consumers / tests can confirm the package loads.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

export const version = pkg.version;
export const name = pkg.name;
