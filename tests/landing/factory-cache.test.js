import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KJL-BUG-0016: the hosting serves every .js as immutable for a year, so the scene's modules
// carry a hash of their content in the URL. A change to a module without a new hash fails here.
const read = (path) => readFileSync(new URL(`../../apps/landing/public/factory/${path}`, import.meta.url), "utf8");
const hashOf = (path) => createHash("sha256").update(read(path)).digest("hex").slice(0, 10);

describe("the factory scene's module URLs", () => {
  const play = read("play/index.html");

  it("load the starter with the hash of its content", () => {
    expect(play).toContain(`<script type="module" src="../replay.js?v=${hashOf("replay.js")}"></script>`);
  });

  it("map the timeline the starter imports to the hash of its content", () => {
    expect(play).toContain(`"/factory/replay-timeline.js": "/factory/replay-timeline.js?v=${hashOf("replay-timeline.js")}"`);
  });
});
