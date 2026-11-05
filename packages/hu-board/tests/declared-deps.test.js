// KJC-BUG-0480: the board installs on its own (npm ci in its folder), so every package its code
// imports is declared here. karajan-core/vec-store loads sqlite-vec, an optional peer of core: the
// board that imports vec-store declares it, or a lockfile update prunes it and the RAG route dies.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const declared = new Set(Object.keys(pkg.dependencies ?? {}));
const sources = fs.readdirSync(path.join(root, "src"), { recursive: true }).filter((f) => f.endsWith(".js"));
const imports = sources.flatMap((f) => [...fs.readFileSync(path.join(root, "src", f), "utf8").matchAll(/\bfrom "([@a-z][\w@./-]*)"/g)].map((m) => m[1]));
const packageOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

describe("hu-board declared dependencies", () => {
  it("declares every package its code imports", () => {
    const missing = [...new Set(imports.filter((s) => !s.startsWith("node:") && !builtinModules.includes(s)).map(packageOf))].filter((p) => !declared.has(p));
    expect(missing).toEqual([]);
  });

  it("declares sqlite-vec when it imports karajan-core/vec-store, and a core that needs no better-sqlite3", () => {
    if (imports.includes("karajan-core/vec-store")) expect(declared.has("sqlite-vec")).toBe(true);
    expect(pkg.dependencies["karajan-core"]).toBe("^1.7.0");
  });
});
