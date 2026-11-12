/**
 * Gradle/Kotlin commands for `kj harden` hooks and its Quality workflow (HU-4037).
 *
 * Inferred from the build, never invented: a lint step only for the plugins the
 * root's build or settings files apply, by id or by version-catalog alias, the
 * tests only when the root has a build file. Every file is read as text; nothing is executed.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BUILD_FILES = ["build.gradle", "build.gradle.kts"];
const PLUGIN_FILES = [...BUILD_FILES, "settings.gradle", "settings.gradle.kts"];
const CATALOG = join("gradle", "libs.versions.toml");
const CATALOG_ENTRY = /^[ \t]*["']?([\w.-]+)["']?[ \t]*=(.*)$/gm;
const ALIAS_USE = /\balias\(\s*libs\.plugins\.([\w.]+)\s*\)/g;
const LINT_TASKS = [
  { plugin: /org\.jlleitschuh\.gradle\.ktlint|com\.pinterest[.:]ktlint/, task: "ktlintCheck" },
  { plugin: /io\.gitlab\.arturbosch\.detekt/, task: "detekt" },
];
const SPOTLESS = /com\.diffplug\.spotless/;
const TOOLCHAIN = /JavaLanguageVersion\.of\(\s*(\d+)\s*\)|jvmToolchain\(\s*(\d+)\s*\)/;

const readText = (dir, files) => files
  .filter((file) => existsSync(join(dir, file)))
  .map((file) => readFileSync(join(dir, file), "utf8"))
  .join("\n");

/** [alias, declaration] of every entry in the version catalog's [plugins] table. */
function catalogPlugins(dir) {
  const tables = readText(dir, [CATALOG]).split(/^[ \t]*\[/m);
  const plugins = tables.find((table) => /^[ \t]*plugins[ \t]*\]/.test(table)) ?? "";
  return Array.from(plugins.matchAll(CATALOG_ENTRY), ([, alias, declaration]) => [alias, declaration]);
}

/**
 * The build and settings files, plus each catalog plugin they apply as `alias(libs.plugins.<alias>)`
 * (`-`/`_` read as `.`). `apply false` counts, as for an id: a root declares its subprojects' plugins
 * that way, and `gradle <task>` runs the task in every project that has it.
 */
function pluginText(dir) {
  const build = readText(dir, PLUGIN_FILES);
  const applied = new Set(Array.from(build.matchAll(ALIAS_USE), ([, accessor]) => accessor));
  const used = catalogPlugins(dir).filter(([alias]) => applied.has(alias.replaceAll(/[-_]/g, ".")));
  return [build, ...used.map(([, declaration]) => declaration)].join("\n");
}

/** `./gradlew` when the root has an executable wrapper, else `gradle`. */
function gradleRunner(dir) {
  try {
    accessSync(join(dir, "gradlew"), constants.X_OK);
    return "./gradlew";
  } catch {
    return "gradle";
  }
}

/** The lint/format/test commands a Gradle root's build declares; {} without a dir. */
export function gradleCommands(dir) {
  if (!dir) return {};
  const runner = gradleRunner(dir);
  const plugins = pluginText(dir);
  const lintTasks = LINT_TASKS.filter(({ plugin }) => plugin.test(plugins)).map(({ task }) => task);
  const cmds = {};
  if (lintTasks.length > 0) cmds.lint = `${runner} ${lintTasks.join(" ")}`;
  if (SPOTLESS.test(plugins)) cmds.format = `${runner} spotlessCheck`;
  if (BUILD_FILES.some((file) => existsSync(join(dir, file)))) cmds.test = `${runner} test`;
  return cmds;
}

/** "21" for the Java toolchain the build declares, or null when it declares none. */
export function gradleJavaVersion(dir) {
  const match = TOOLCHAIN.exec(readText(dir, BUILD_FILES));
  return match ? (match[1] ?? match[2]) : null;
}

/** The inputs for qualityWorkflowFor's gradle options, plus the note when kj falls back to Java 17. */
export function gradleInputs({ appDir }) {
  const { lint = null, test = null } = gradleCommands(appDir);
  const javaVersion = gradleJavaVersion(appDir);
  const note = javaVersion ? "" : "kj-quality: no Java toolchain in the Gradle build; using 17";
  return { options: { gradle: { javaVersion, lint, test } }, note };
}
