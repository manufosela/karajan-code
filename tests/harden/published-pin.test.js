// KJC-BUG-0420 (#2664): kj harden pinned the policy workflow's npx fallback to the
// local package.json version. Run from a checkout ahead of npm, CI died with
// "No matching version found" before judging anything.
import { describe, it, expect, vi } from "vitest";
import { publishedPin } from "../../src/harden/published-pin.js";

const registry = (versions) => vi.fn(async () => ({ ok: true, json: async () => ({ versions: Object.fromEntries(versions.map((v) => [v, {}])) }) }));

describe("publishedPin", () => {
  it("keeps the running version when npm has it", async () => {
    const fetchFn = registry(["4.69.0", "4.70.0"]);
    expect(await publishedPin({ name: "@karajan-family/code", version: "4.70.0", fetchFn })).toMatchObject({ version: "4.70.0" });
    expect(fetchFn.mock.calls[0][0]).toBe("https://registry.npmjs.org/%40karajan-family%2Fcode");
  });

  it("pins the newest published version not newer than the running one, and says so", async () => {
    const pin = await publishedPin({ name: "karajan-code", version: "5.0.0", fetchFn: registry(["4.69.0", "4.70.2", "5.0.0-beta.1", "3.0.0"]) });
    expect(pin.version).toBe("4.70.2");
    expect(pin.note).toMatch(/5\.0\.0 is not on npm.*4\.70\.2/);
    expect(pin.published).toContain("4.70.2");
  });

  it("pins nothing, loudly, when the registry cannot be read (HU-4278)", async () => {
    const down = vi.fn(async () => { throw new Error("getaddrinfo ENOTFOUND"); });
    const pin = await publishedPin({ name: "karajan-code", version: "4.70.0", fetchFn: down });
    expect(pin).toMatchObject({ version: null, published: null, note: expect.stringMatching(/could not confirm.*ENOTFOUND/) });
    const none = await publishedPin({ name: "karajan-code", version: "1.0.0", fetchFn: registry(["4.70.0"]) });
    expect(none).toMatchObject({ version: null, published: ["4.70.0"] });
  });
});
