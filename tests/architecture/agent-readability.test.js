/**
 * Architecture regression guard — verify Karajan's agent-readability
 * promise: every CLI subcommand listed as having a SKILL.md in
 * `llms.txt` actually resolves to a file under `docs/agents/`.
 *
 * KJC-TSK-0349. Without this guard, llms.txt rots silently:
 * we'd ship a "kj does X — see SKILL.kj-x.md" line that 404s
 * for every external agent following it. The fix is one line of
 * code; the audit was not catching it.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LLMS_TXT = path.join(REPO_ROOT, "llms.txt");
const SKILL_DIR = path.join(REPO_ROOT, "docs/agents");

/**
 * Pull every `[label](docs/agents/SKILL.kj-foo.md)` link out of
 * llms.txt. Returns the relative paths exactly as written so the
 * error messages point at the real source line.
 */
function extractSkillLinks(text) {
  const re = /\(docs\/agents\/(SKILL\.kj-[a-z0-9-]+\.md)\)/g;
  const out = new Set();
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

describe("agent-readability — llms.txt SKILL links resolve", () => {
  it("llms.txt exists at repo root", () => {
    expect(fs.existsSync(LLMS_TXT), "llms.txt should exist at repo root for agent discovery").toBe(true);
  });

  it("docs/agents/ contains a README.md as the entry point", () => {
    const readme = path.join(SKILL_DIR, "README.md");
    expect(fs.existsSync(readme), "docs/agents/README.md is the agent-facing entry point").toBe(true);
  });

  it("every SKILL.md link in llms.txt resolves to an actual file", () => {
    const text = fs.readFileSync(LLMS_TXT, "utf8");
    const links = extractSkillLinks(text);

    expect(links.length, "llms.txt should advertise at least one SKILL.md").toBeGreaterThan(0);

    const missing = [];
    for (const filename of links) {
      const abs = path.join(SKILL_DIR, filename);
      if (!fs.existsSync(abs)) missing.push(filename);
    }

    expect(
      missing,
      "llms.txt advertises SKILL files that don't exist:\n  " +
      missing.map((f) => `docs/agents/${f}`).join("\n  ") +
      "\n\nEither create them under docs/agents/ or remove the link from llms.txt.",
    ).toEqual([]);
  });

  it("every SKILL.md under docs/agents/ has the expected sections", () => {
    const REQUIRED_SECTIONS = ["What it does", "Inputs", "Outputs", "Example"];
    const files = fs.readdirSync(SKILL_DIR)
      .filter((f) => f.startsWith("SKILL.kj-") && f.endsWith(".md"));

    expect(files.length, "docs/agents/ should contain SKILL.kj-*.md files").toBeGreaterThan(0);

    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(path.join(SKILL_DIR, file), "utf8");
      for (const section of REQUIRED_SECTIONS) {
        const re = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "m");
        if (!re.test(text)) {
          offenders.push(`${file} → missing "## ${section}"`);
        }
      }
    }

    expect(
      offenders,
      "SKILL.md files missing required sections:\n  " +
      offenders.join("\n  ") +
      "\n\nEvery SKILL.md must have ## What it does, ## Inputs, ## Outputs, ## Example " +
      "for agents to consume them deterministically.",
    ).toEqual([]);
  });
});
