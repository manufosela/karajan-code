// KJC-TSK-0937 (MDR-A, ADR 0016): every rule written in the governing MD files,
// with a stable id, its literal text and where it lives.
import { describe, it, expect } from "vitest";
import { extractRules } from "../../src/rules/inventory.js";

describe("extractRules", () => {
  it("takes the lines with a normative marker, outside code blocks, and skips the rest", () => {
    const md = [
      "# Reglas",
      "",
      "- **NUNCA** commitear credenciales.",
      "Texto descriptivo sin norma.",
      "- Sprints: uno por día, SIEMPRE con startDate.",
      "```sh",
      "# never run this in prod",
      "```",
      "* You must stage files by name.",
      "| a | b |",
    ].join("\n");
    const rules = extractRules(md, "CLAUDE.md");
    expect(rules.map((r) => r.text)).toEqual([
      "NUNCA commitear credenciales.",
      "Sprints: uno por día, SIEMPRE con startDate.",
      "You must stage files by name.",
    ]);
    expect(rules[0]).toMatchObject({ file: "CLAUDE.md", line: 3 });
    expect(rules[0].id).toMatch(/^R-[0-9a-f]{10}$/);
  });

  it("skips code fenced with tildes or longer backtick runs, closed only by a matching fence", () => {
    const md = ["~~~", "never inside tildes", "~~~", "````md", "```", "never inside a nested fence", "````", "- Always outside."].join("\n");
    expect(extractRules(md, "x.md").map((r) => r.text)).toEqual(["Always outside."]);
  });

  it("skips a memory file's YAML frontmatter", () => {
    const md = "---\nname: x\ndescription: Never commit to main.\n---\n\nNEVER commit to main.\n";
    expect(extractRules(md, "feedback_x.md").map((r) => r.line)).toEqual([6]);
  });

  it("the id depends on the text, not on its line or its markdown", () => {
    const [a] = extractRules("- **NUNCA** commitear credenciales.", "a.md");
    const [b] = extractRules("\n\n1. NUNCA   commitear `credenciales`.", "b.md");
    expect(a.id).toBe(b.id);
    expect(b.line).toBe(3);
    const ids = ["Never commit to main.", "_Never_ commit to main.", "*Never* commit to main."].map((t) => extractRules(t, "c.md")[0].id);
    expect(new Set(ids).size).toBe(1);
  });

  it("keeps snake_case names, globs (in a code span or not) and what a code span holds", () => {
    const [r] = extractRules("- Never touch `docs/**/*.md` or KJ_ALLOW_X in feedback_x.md.", "a.md");
    expect(r.text).toBe("Never touch docs/**/*.md or KJ_ALLOW_X in feedback_x.md.");
    const [bare] = extractRules("Never edit docs/**/*.md by hand.", "a.md");
    expect(bare.text).toBe("Never edit docs/**/*.md by hand.");
    const [bold] = extractRules("- **NUNCA usar `git add -A`**: stagea por nombre.", "a.md");
    expect(bold.text).toBe("NUNCA usar git add -A: stagea por nombre.");
  });
});
