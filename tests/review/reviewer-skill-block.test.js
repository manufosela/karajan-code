// KJC-TSK-1272 (#2753): a third-party review resolves the skills itself (the
// reviewed repo's stack) and hands them to the prompt, instead of the project's.
import { describe, it, expect } from "vitest";
import { buildReviewerPrompt } from "../../src/prompts/reviewer.js";

const block = { skills: [{ name: "astro", content: "# astro rules", path: "/tmp/s/astro/SKILL.md", catalog: true }], dropped: ["ts"], limit: 3 };

describe("reviewer prompt with a skill block from the caller", () => {
  it("puts the caller's skills in the prompt, for claude as paths to read", async () => {
    const prompt = await buildReviewerPrompt({ task: "t", diff: "+x", reviewRules: "r", mode: "standard", provider: "claude", roleSkillBlock: block });
    expect(prompt).toContain("- astro: read /tmp/s/astro/SKILL.md");
    expect(prompt).toContain("Left out (limit 3): ts");
  });

  it("inlines them for other providers", async () => {
    const prompt = await buildReviewerPrompt({ task: "t", diff: "+x", reviewRules: "r", mode: "standard", provider: "codex", roleSkillBlock: block });
    expect(prompt).toContain("### astro\n# astro rules");
  });
});
