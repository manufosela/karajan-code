/**
 * Detects the project technology stack by scanning project files.
 * Used by `kj init` to auto-configure roles, skills, and settings.
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Frameworks detectable from package.json dependencies.
 * Maps dependency name -> { name, type } where type is "frontend" | "backend" | "fullstack".
 */
const PKG_FRAMEWORKS = {
  react: { name: "react", type: "frontend" },
  "react-dom": { name: "react", type: "frontend" },
  vue: { name: "vue", type: "frontend" },
  svelte: { name: "svelte", type: "frontend" },
  "@angular/core": { name: "angular", type: "frontend" },
  astro: { name: "astro", type: "frontend" },
  next: { name: "next", type: "fullstack" },
  nuxt: { name: "nuxt", type: "fullstack" },
  "solid-js": { name: "solid", type: "frontend" },
  lit: { name: "lit", type: "frontend" },
  express: { name: "express", type: "backend" },
  fastify: { name: "fastify", type: "backend" },
  "@nestjs/core": { name: "nestjs", type: "backend" },
  hono: { name: "hono", type: "backend" },
  koa: { name: "koa", type: "backend" },
};

/**
 * Language markers: file presence -> { language, type }.
 */
const LANGUAGE_FILE_MARKERS = [
  { file: "go.mod", language: "go", type: "backend" },
  { file: "Cargo.toml", language: "rust", type: "backend" },
  { file: "pom.xml", language: "java", type: "backend" },
  { file: "build.gradle", language: "java", type: "backend" },
  { file: "build.gradle.kts", language: "kotlin", type: "backend" },
  { file: "pyproject.toml", language: "python", type: "backend" },
  { file: "setup.py", language: "python", type: "backend" },
  { file: "requirements.txt", language: "python", type: "backend" },
  { file: "Gemfile", language: "ruby", type: "backend" },
  { file: "composer.json", language: "php", type: "backend" },
  { file: "pubspec.yaml", language: "dart", type: "frontend" },
  { file: "Package.swift", language: "swift", type: "backend" },
];

/**
 * Maps framework names to skill names for auto-install suggestions.
 */
const FRAMEWORK_TO_SKILL = {
  react: "react",
  vue: "vue",
  svelte: "svelte",
  angular: "angular",
  astro: "astro",
  next: "nextjs",
  nuxt: "vue",
  solid: "solid",
  lit: "lit",
  express: "express",
  fastify: "fastify",
  nestjs: "nestjs",
};

/**
 * Detect the project technology stack.
 * @param {string} projectDir - Absolute path to project root.
 * @returns {Promise<{frameworks: string[], language: string|null, isFrontend: boolean, isBackend: boolean, isFullstack: boolean, suggestions: {impeccable: boolean, skills: string[]}}>}
 */
export async function detectProjectStack(projectDir) {
  const frameworks = new Set();
  let language = null;
  let hasFrontend = false;
  let hasBackend = false;

  // 1. Scan package.json for known frameworks
  try {
    const pkgRaw = await fs.readFile(path.join(projectDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (!language) language = "javascript";

    // Check for TypeScript
    if (allDeps.typescript || allDeps["ts-node"]) {
      language = "typescript";
    }

    for (const [dep, info] of Object.entries(PKG_FRAMEWORKS)) {
      if (allDeps[dep]) {
        frameworks.add(info.name);
        if (info.type === "frontend" || info.type === "fullstack") hasFrontend = true;
        if (info.type === "backend" || info.type === "fullstack") hasBackend = true;
      }
    }
  } catch { /* no package.json or parse error */ }

  // 2. Check language file markers
  for (const marker of LANGUAGE_FILE_MARKERS) {
    try {
      await fs.access(path.join(projectDir, marker.file));
      if (!language || language === "javascript") {
        language = marker.language;
      }
      if (marker.type === "frontend") hasFrontend = true;
      if (marker.type === "backend") hasBackend = true;
    } catch { /* file not found */ }
  }

  const frameworkList = Array.from(frameworks);
  const isFullstack = hasFrontend && hasBackend;

  // Build suggestions
  const skills = [];
  for (const fw of frameworkList) {
    const skill = FRAMEWORK_TO_SKILL[fw];
    if (skill && !skills.includes(skill)) {
      skills.push(skill);
    }
  }

  return {
    frameworks: frameworkList,
    language,
    isFrontend: hasFrontend,
    isBackend: hasBackend,
    isFullstack,
    suggestions: {
      impeccable: hasFrontend,
      skills,
    },
  };
}
