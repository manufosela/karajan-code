/**
 * KJC-BUG-0104 — the SEA binary shipped NO templates/: esbuild rewrites
 * import.meta.dirname to the binary's own directory, so `kj init` resolved
 * `$HOME/templates/skills` and warned ENOENT, and built-in role prompts /
 * config-init / onboard templates were unreachable on a fresh machine.
 *
 * Fix: templates travel as SEA assets (scripts/build-sea.mjs) and
 * src/utils/templates-root.js extracts them once per version. These tests
 * cover the two halves that run outside a real SEA binary:
 *  - the build-side asset collection (every template file is listed)
 *  - the runtime extraction (idempotent, faithful contents)
 *  - the non-SEA path (source tree resolves to the real templates/)
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectTemplateFiles } from "../scripts/esbuild-sea.config.mjs";
import { getTemplatesRoot, extractEmbeddedTemplates } from "../src/utils/templates-root.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("SEA templates (KJC-BUG-0104)", () => {
  it("collectTemplateFiles lists every built-in template the runtime depends on", () => {
    const files = collectTemplateFiles();
    // The exact files each consumer needs: skills (init), built-in role
    // prompts (prompt-resolver), coder-rules + workflows (init/config-init).
    expect(files).toContain("coder-rules.md");
    expect(files).toContain("review-rules.md");
    expect(files.some((f) => f.startsWith(path.join("skills", "")))).toBe(true);
    expect(files.some((f) => f.startsWith(path.join("roles", "")))).toBe(true);
    expect(files.some((f) => f.startsWith(path.join("workflows", "")))).toBe(true);
    // Sanity: matches what actually lives on disk.
    expect(files.length).toBeGreaterThanOrEqual(70);
    for (const rel of files) {
      expect(fs.existsSync(path.join(REPO_ROOT, "templates", rel))).toBe(true);
    }
  });

  it("getTemplatesRoot resolves the real templates/ dir outside a SEA binary", () => {
    const root = getTemplatesRoot();
    expect(root).toBe(path.join(REPO_ROOT, "templates"));
    expect(fs.existsSync(path.join(root, "skills"))).toBe(true);
  });

  it("extractEmbeddedTemplates writes every file faithfully and is idempotent", () => {
    const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kj-tpl-extract-"));
    try {
      const files = ["coder-rules.md", path.join("skills", "kj-run.md")];
      const contents = { "coder-rules.md": "# rules", [path.join("skills", "kj-run.md")]: "# skill" };
      let reads = 0;
      const readAsset = (rel) => {
        reads += 1;
        return contents[rel];
      };

      const first = extractEmbeddedTemplates({ destRoot, files, readAsset });
      expect(first).toBe(destRoot);
      expect(fs.readFileSync(path.join(destRoot, "coder-rules.md"), "utf8")).toBe("# rules");
      expect(fs.readFileSync(path.join(destRoot, "skills", "kj-run.md"), "utf8")).toBe("# skill");
      expect(reads).toBe(2);

      // Second call sees the .complete marker and never re-reads assets.
      extractEmbeddedTemplates({ destRoot, files, readAsset });
      expect(reads).toBe(2);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});
