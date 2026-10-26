/**
 * atril — skills, commands and subagents for every AI CLI, on demand
 * (ADR 0021). It imports nothing outside this package: Karajan is one
 * consumer, calling this module exactly as a third party would.
 */
import { readFileSync } from "node:fs";

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export { search } from "./search.js";
export { resolve, resolveBlock } from "./resolve.js";
export { MARKER, expose, persistentPieces, unexpose } from "./bridge.js";
export { sync } from "./sync.js";
export { generate } from "./generate.js";
export { install, remove } from "./store.js";
export { catalogSync } from "./fetch.js";
export { installFromCatalog } from "./catalog-install.js";
export { importSkills } from "./import.js";
export { recommended } from "./recommended.js";
export { applyCatalogUpdate, catalogUpdates } from "./update.js";
