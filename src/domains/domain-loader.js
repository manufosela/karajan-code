/**
 * Domain Knowledge loader.
 * Scans .karajan/domains/ (project-local) and ~/.karajan/domains/ (user-global)
 * for DOMAIN.md files with YAML frontmatter.
 * Project-local domains override user-global domains by directory name.
 */

import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import yaml from "js-yaml";
import { getKarajanHome } from "../utils/paths.js";

const DOMAIN_FILE = "DOMAIN.md";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a DOMAIN.md file into a structured DomainFile object.
 * @param {string} filePath — absolute path to the DOMAIN.md file
 * @returns {Promise<DomainFile|null>} parsed domain or null on error
 *
 * @typedef {Object} DomainSection
 * @property {string} heading — section heading (e.g. "Core Concepts")
 * @property {string} content — section body (markdown)
 *
 * @typedef {Object} DomainFile
 * @property {string} name
 * @property {string} description
 * @property {string[]} tags
 * @property {string} version
 * @property {string} author
 * @property {string} visibility — "private" | "public"
 * @property {Array<{type: string, note?: string}>} sources
 * @property {string} content — full markdown body (after frontmatter)
 * @property {DomainSection[]} sections — parsed markdown sections
 * @property {string} filePath — original file path
 * @property {string} [origin] — "project" | "user" (set by loadDomains)
 */
export async function parseDomainFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;

  let meta;
  try {
    meta = yaml.load(match[1]);
  } catch {
    return null;
  }

  if (!meta || typeof meta !== "object" || !meta.name) return null;

  const content = match[2].trim();
  const sections = parseSections(content);

  return {
    name: meta.name,
    description: meta.description || "",
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    version: meta.version || "0.0.0",
    author: meta.author || "",
    visibility: meta.visibility || "private",
    sources: Array.isArray(meta.sources) ? meta.sources : [],
    content,
    sections,
    filePath
  };
}

/**
 * Split markdown content into sections by ## headings.
 * @param {string} content
 * @returns {DomainSection[]}
 */
function parseSections(content) {
  const sections = [];
  const lines = content.split("\n");
  let current = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (current) {
        current.content = current.content.trim();
        sections.push(current);
      }
      current = { heading: headingMatch[1].trim(), content: "" };
    } else if (current) {
      current.content += line + "\n";
    }
  }

  if (current) {
    current.content = current.content.trim();
    sections.push(current);
  }

  return sections;
}

/**
 * Auto-detect project context files (README.md, CLAUDE.md) as lightweight domains.
 * Used as fallback when no explicit .karajan/domains/ are configured.
 *
 * @param {string} projectDir — absolute path to project root
 * @returns {Promise<DomainFile[]>}
 */
export async function autoDetectDomains(projectDir) {
  if (!projectDir) return [];

  const candidates = ["README.md", "CLAUDE.md", "docs/README.md"];
  const detected = [];

  for (const rel of candidates) {
    const filePath = join(projectDir, rel);
    let content;
    try {
      content = await readFile(filePath, "utf-8");
    } catch { continue; }

    if (!content || content.trim().length < 20) continue;

    // Truncate to first 4000 chars to avoid bloating context
    const trimmed = content.length > 4000 ? content.slice(0, 4000) + "\n\n[...truncated]" : content;

    detected.push({
      name: `auto:${rel}`,
      description: `Auto-detected from ${rel}`,
      tags: [],
      version: "0.0.0",
      author: "",
      visibility: "private",
      sources: [{ type: "auto-detect", note: rel }],
      content: trimmed,
      sections: parseSections(trimmed),
      filePath,
      origin: "auto-detect"
    });
  }

  return detected;
}

/**
 * Load all domains from project-local and user-global directories.
 * Falls back to auto-detecting README.md/CLAUDE.md when no explicit domains found.
 * Project-local domains override user-global domains when directory names match.
 *
 * @param {string|null} projectDir — absolute path to project root (null = user-global only)
 * @returns {Promise<DomainFile[]>}
 */
export async function loadDomains(projectDir) {
  const userDir = join(getKarajanHome(), "domains");
  const projectDomainDir = projectDir ? join(projectDir, ".karajan", "domains") : null;

  // Load user-global first, then project-local overrides
  const userDomains = await scanDomainDir(userDir, "user");
  const projectDomains = projectDomainDir ? await scanDomainDir(projectDomainDir, "project") : [];

  // Build a map keyed by directory name for merge.
  const merged = new Map();

  for (const { dirName, domain } of userDomains) {
    merged.set(dirName, domain);
  }
  for (const { dirName, domain } of projectDomains) {
    merged.set(dirName, domain); // project overrides user
  }

  const explicit = Array.from(merged.values());

  // Fallback: auto-detect README.md, CLAUDE.md when no explicit domains found
  if (explicit.length === 0 && projectDir) {
    return autoDetectDomains(projectDir);
  }

  return explicit;
}

/**
 * Scan a single domains directory for DOMAIN.md files.
 * @param {string} dir — absolute path to a domains/ directory
 * @param {string} origin — "project" | "user"
 * @returns {Promise<Array<{dirName: string, domain: DomainFile}>>}
 */
async function scanDomainDir(dir, origin) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const domainPath = join(dir, entry.name, DOMAIN_FILE);
    const domain = await parseDomainFile(domainPath);

    if (domain) {
      domain.origin = origin;
      results.push({ dirName: entry.name, domain });
    }
  }

  return results;
}

/**
 * Persist an inline domain (text or file path) to .karajan/domains/inline/DOMAIN.md.
 * If domainInput is a path to an existing .md file, reads its content.
 * Otherwise treats it as inline text.
 *
 * @param {string} domainInput — inline text or absolute path to a .md file
 * @param {string} projectDir — project root
 */
export async function persistInlineDomain(domainInput, projectDir) {
  if (!domainInput || !projectDir) return;

  let content = domainInput;

  // If it looks like a file path, try to read it
  if (isAbsolute(domainInput) && domainInput.endsWith(".md")) {
    try {
      const s = await stat(domainInput);
      if (s.isFile()) {
        content = await readFile(domainInput, "utf-8");
      }
    } catch { /* treat as inline text */ }
  }

  const domainDir = join(projectDir, ".karajan", "domains", "inline");
  await mkdir(domainDir, { recursive: true });

  const domainFile = join(domainDir, DOMAIN_FILE);
  const wrapped = `---\nname: inline-domain\ndescription: Domain knowledge provided via --domain parameter\ntags: []\nversion: "0.0.0"\n---\n\n${content}\n`;
  await writeFile(domainFile, wrapped, "utf-8");
}
