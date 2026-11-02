// The package entry is atril's public contract (ADR 0021, decision 5): what a consumer such as
// Karajan imports. A name leaving it is a breaking change, so the set is pinned here.
import { describe, expect, it } from "vitest";
import * as atril from "../src/index.js";
describe("atril's entry", () => {
  it("exports exactly the public API", () => {
    expect(Object.keys(atril).toSorted()).toEqual([
      "MARKER", "VERSION", "applyCatalogUpdate", "applyRecommended", "catalogSync", "catalogUpdates", "declaredPluginConfig", "detectPluginFormat", "expose", "generate", "importSkills", "install",
      "installFromCatalog", "installPlugin", "installPluginSet", "listPluginMarkdown", "persistentPieces", "pluginInstallSet", "readPluginConfig", "readPluginManifest", "recommended", "remove", "resolve", "resolveBlock", "search",
      "status", "sync", "unexpose", "writePluginConfig",
    ]);
  });
});
