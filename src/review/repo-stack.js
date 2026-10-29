/**
 * KJC-TSK-1267 (#2753): the reviewed repo's stack, read at the BASE commit with
 * git, so the PR cannot invent a stack to pull skills in. Languages come from
 * file extensions, frameworks from the dependencies the manifests declare.
 * Deterministic, no tokens: it only picks which skills to look for.
 */
import { runCommand } from "../utils/process.js";

const LANGUAGES = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", rb: "ruby", php: "php", cs: "csharp",
  swift: "swift", astro: "astro", vue: "vue", svelte: "svelte", css: "css", scss: "css", sql: "sql", sh: "shell",
};
const FRAMEWORKS = [
  "react", "next", "vue", "nuxt", "svelte", "astro", "angular", "lit", "express", "fastify", "nestjs", "vite",
  "vitest", "jest", "playwright", "firebase", "tailwindcss", "django", "flask", "fastapi", "pytest",
  "gin", "echo", "fiber", "axum", "actix-web", "rocket", "spring-boot",
];
const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?)$/;
const SKIP = /(^|\/)(node_modules|vendor|dist|build)\//;
const MAX_MANIFESTS = 20;

const gitOut = async (projectDir, args) => {
  const res = await runCommand("git", args, { cwd: projectDir });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${(res.stderr || "").trim()}`);
  return res.stdout;
};

/**
 * The dependency tokens a manifest declares: package.json's names, a scoped one also by its
 * scope (`@angular/core` → angular, core), and the words of any other manifest.
 */
function depsOf(file, text) {
  if (!file.endsWith("package.json")) return text.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
  const pkg = JSON.parse(text);
  const names = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((k) => Object.keys(pkg[k] ?? {}));
  return names.flatMap((n) => n.replace(/^@/, "").split("/"));
}

/** A framework is named whole or as the head of a dash-joined token (spring-boot-starter-web → spring-boot). */
const declares = (deps, name) => deps.some((dep) => dep === name || dep.startsWith(`${name}-`));

/**
 * @returns {Promise<{languages: string[], frameworks: string[], unreadable?: string[]}>} sorted, without
 *   repeats; a manifest that does not parse (a broken fixture) is named in `unreadable`, never dropped in silence
 */
export async function detectStack({ projectDir, base }) {
  const files = (await gitOut(projectDir, ["ls-tree", "-r", "--name-only", base])).split("\n").filter((f) => f && !SKIP.test(f));
  const languages = new Set(files.map((f) => LANGUAGES[f.split(".").at(-1)?.toLowerCase()]).filter(Boolean));
  const frameworks = new Set();
  const unreadable = [];
  for (const manifest of files.filter((f) => MANIFEST.test(f)).slice(0, MAX_MANIFESTS)) {
    const blobRef = `${base}:${manifest}`;
    let deps;
    try { deps = depsOf(manifest, await gitOut(projectDir, ["show", blobRef])); } catch { unreadable.push(manifest); continue; }
    FRAMEWORKS.filter((name) => declares(deps, name)).forEach((name) => frameworks.add(name));
  }
  return { languages: [...languages].toSorted(), frameworks: [...frameworks].toSorted(), ...(unreadable.length && { unreadable }) };
}
