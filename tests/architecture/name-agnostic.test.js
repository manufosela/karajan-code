// MIG-A (KJC-TSK-0751, épica KJC-PCS-0077) — inventario de self-references:
// con el dual-publish del scope, NINGUNA ruta crítica puede depender del
// literal "karajan-code" en CÓDIGO (comentarios y URLs de GitHub del REPO,
// que no cambia, quedan fuera). Este test fija que el literal no vuelve.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { packageName, registryLatestUrl } from "../../src/utils/update-check.js";

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
// Solo código: fuera comentarios de línea y URLs del repo GitHub.
const codeLines = (p) =>
  src(p).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.includes("github.com") && !l.includes("githubusercontent.com"));

describe("self-references name-agnósticas (MIG-A)", () => {
  it("update-check resuelve su nombre del manifest (y cae al legacy si no puede leerlo)", () => {
    expect(packageName()).toBe(JSON.parse(src("package.json")).name);
    // El literal solo puede vivir como FALLBACK del resolver (_pkgName);
    // en registry URLs, mensajes de install o comandos está vetado.
    const uses = codeLines("src/utils/update-check.js").filter((l) => !l.includes("_pkgName"));
    expect(uses.join("\n")).not.toMatch(/PACKAGE_NAME|"karajan-code"|karajan-code@/);
  });

  it("la URL del registro codifica el nombre — el scoped lleva @ y / (catch de codex)", () => {
    expect(registryLatestUrl("@karajan-family/code")).toBe("https://registry.npmjs.org/%40karajan-family%2Fcode/latest");
    expect(registryLatestUrl("karajan-code")).toBe("https://registry.npmjs.org/karajan-code/latest");
  });

  it("verify-pack no hardcodea el nombre — valida el tarball que sea", () => {
    expect(codeLines("scripts/verify-pack.mjs").join("\n")).not.toMatch(/"karajan-code"|karajan-code@/);
  });

  it("la plantilla del workflow de policy recibe nombre y versión — jamás el literal", () => {
    expect(codeLines("src/harden/workflow-templates.js").join("\n")).not.toMatch(/karajan-code@/);
  });
});
