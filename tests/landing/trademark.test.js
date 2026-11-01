import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-TSK-0149: the name is claimed as a trademark (™) while the application is
// pending; ® is only allowed once it is granted.
const publicDir = new URL("../../apps/landing/public/", import.meta.url);
const pages = ["index.html", "es/index.html", "family.html", "es/family.html", "method.html", "es/method.html"];

describe.each(pages)("trademark in %s", (path) => {
  const html = readFileSync(new URL(path, publicDir), "utf8");

  it("names Karajan Code™ in the footer", () => {
    expect(html.match(/<footer[\s\S]*?<\/footer>/)[0]).toContain("Karajan Code™");
  });

  it("never claims a registered mark", () => {
    expect(html).not.toMatch(/®|&reg;|marca registrada|registered trademark/i);
  });
});
