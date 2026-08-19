#!/usr/bin/env node
/**
 * dual-publish (MIG-A, KJC-TSK-0751, épica KJC-PCS-0077, ADR 0004) — el
 * MISMO contenido sale bajo dos nombres npm durante la migración al scope:
 * karajan-code (legacy, publish normal) y @karajan-family/code (scoped).
 *
 * Uso:
 *   node scripts/dual-publish.mjs --pack-only          # genera+verifica el tarball scoped
 *   node scripts/dual-publish.mjs --publish --otp=XXX  # publica el scoped (tras publicar el legacy)
 *
 * El swap del name es EN SITIO con restauración en finally: un crash a mitad
 * no deja el manifest renombrado. La verificación es el MISMO verify-pack
 * (name-agnóstico desde la parte 1): empaqueta, instala aislado y corre kj.
 * El PRIMER publish del scoped lo hace el usuario (cuenta karajan-family,
 * security key); los siguientes van con la sesión normal.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LEGACY_NAME = "karajan-code";
export const SCOPED_NAME = "@karajan-family/code";

/**
 * Ejecuta `fn` con el manifest renombrado al scoped (+ publishConfig public,
 * obligatorio para scoped) y lo RESTAURA byte a byte pase lo que pase.
 */
export async function withScopedName(repoRoot, fn) {
  const pkgPath = join(repoRoot, "package.json");
  const original = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(original);
  if (pkg.name !== LEGACY_NAME) {
    throw new Error(`dual-publish: el manifest dice "${pkg.name}" y solo se renombra desde ${LEGACY_NAME} — jamás a ciegas`);
  }
  // publishConfig se MERGEA, no se pisa (catch de codex): un registry/tag
  // preexistente debe sobrevivir al publish scoped.
  writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, name: SCOPED_NAME, publishConfig: { ...pkg.publishConfig, access: "public" } }, null, 2)}\n`, "utf8");
  try {
    return await fn();
  } finally {
    writeFileSync(pkgPath, original, "utf8");
  }
}

// argv[1] normalizado (catch de codex): node lo absolutiza hoy, pero el
// guard no debe depender de ese detalle de implementación.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const publish = args.includes("--publish");
  const otp = args.find((a) => a.startsWith("--otp="))?.slice(6);
  await withScopedName(repoRoot, async () => {
    console.log(`dual-publish: manifest → ${SCOPED_NAME} (temporal)`);
    // La E2E real: empaqueta el scoped, instálalo aislado y corre kj.
    execFileSync("node", [join(repoRoot, "scripts", "verify-pack.mjs")], { cwd: repoRoot, stdio: "inherit" });
    if (publish) {
      const pubArgs = ["publish", "--ignore-scripts", ...(otp ? [`--otp=${otp}`] : [])];
      console.log(`dual-publish: npm ${pubArgs.join(" ").replace(/--otp=\S+/, "--otp=***")}`);
      execFileSync("npm", pubArgs, { cwd: repoRoot, stdio: "inherit" });
    } else {
      console.log("dual-publish: --pack-only — verificado y SIN publicar (usa --publish en la release)");
    }
  });
  console.log(`dual-publish: manifest restaurado a ${LEGACY_NAME} ✓`);
}
