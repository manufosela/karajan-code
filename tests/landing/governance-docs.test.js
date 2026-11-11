import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0127: the Governance guide cites only commands kj registers today, in both languages.
const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const docs = "apps/landing/docs/src/content/docs/";

// Read from the CLI's source, not from an installed kj, so the test holds on any machine.
const registered = new Set(
  [...read("src/cli/register-meta.js").matchAll(/(policy|identity)Cmd\s*\.command\("([\w-]+)"/g)].map(
    ([, group, sub]) => `${group} ${sub}`,
  ),
);

describe.each(["v4/governance.md", "es/v4/governance.md"])("the Governance guide %s", (page) => {
  const text = read(`${docs}${page}`);

  it("cites only policy and identity subcommands kj registers", () => {
    const cited = [...text.matchAll(/kj (policy|identity) ([a-z][\w-]*)/g)].map(([, group, sub]) => `${group} ${sub}`);
    expect(cited.length).toBeGreaterThan(5);
    for (const command of cited) expect(registered, command).toContain(command);
  });

  it("covers every part the card asks for, without em dashes", () => {
    for (const term of ["policy.yml", "grant", "anchor", "kj policy check", "kj identity", "@karajan-family/governance"]) {
      expect(text).toContain(term);
    }
    expect(text).toMatch(/\| *A *\|[\s\S]*\| *B *\|[\s\S]*\| *C *\|/);
    expect(text).not.toContain("—");
  });
});

describe("the links to the Governance guide", () => {
  it("is in the sidebar, after the gates", () => {
    expect(read("apps/landing/docs/astro.config.mjs")).toMatch(/slug: 'v4\/gates'[^\n]*\n\s*\{ label: 'Governance', slug: 'v4\/governance'/);
  });

  it.each([
    ["v4/gates.md", "/docs/v4/governance/"],
    ["es/v4/gates.md", "/docs/es/v4/governance/"],
  ])("%s links to it", (page, href) => {
    expect(read(`${docs}${page}`)).toContain(`](${href})`);
  });

  it.each(["guides/sentinel.md", "es/guides/sentinel.md"])("%s no longer offers an identity escape", (page) => {
    expect(read(`${docs}${page}`)).not.toContain("KJ_ALLOW_IDENTITY");
  });
});
