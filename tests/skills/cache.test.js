import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let originalKarajanHome;

vi.mock("../../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn(() => originalKarajanHome),
  getSessionRoot: vi.fn(() => path.join(originalKarajanHome, "sessions")),
}));

describe("skills/skills-cache", () => {
  let getCachedMeta, isFresh, recordInstall, clearCache, listCached, getCacheRoot, DEFAULT_TTL_MS;
  let tmpHome;

  beforeEach(async () => {
    vi.resetAllMocks();
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "kj-cache-test-"));
    originalKarajanHome = tmpHome;
    const paths = await import("../../src/utils/paths.js");
    paths.getKarajanHome.mockReturnValue(tmpHome);
    ({ getCachedMeta, isFresh, recordInstall, clearCache, listCached, getCacheRoot, DEFAULT_TTL_MS } = await import("../../src/skills/skills-cache.js"));
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  });

  it("getCachedMeta returns null when skill is not cached", async () => {
    expect(await getCachedMeta("nonexistent")).toBeNull();
  });

  it("recordInstall writes meta.json and getCachedMeta reads it back", async () => {
    await recordInstall("java-code-review", { source: "java-code-review" });
    const meta = await getCachedMeta("java-code-review");
    expect(meta).toBeTruthy();
    expect(meta.name).toBe("java-code-review");
    expect(meta.source).toBe("java-code-review");
    expect(typeof meta.cachedAt).toBe("string");
  });

  it("isFresh is true right after recordInstall", async () => {
    await recordInstall("react-patterns");
    expect(await isFresh("react-patterns")).toBe(true);
  });

  it("isFresh is false when the TTL has elapsed", async () => {
    await recordInstall("react-patterns");
    // Simulate 8 days elapsed by rewriting the meta file
    const metaFile = path.join(getCacheRoot(), "react-patterns", "meta.json");
    const old = JSON.parse(await fs.readFile(metaFile, "utf8"));
    old.cachedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(metaFile, JSON.stringify(old));
    expect(await isFresh("react-patterns")).toBe(false);
  });

  it("isFresh respects a custom TTL", async () => {
    await recordInstall("react-patterns");
    // TTL=0 forces "always stale"; the delta since cachedAt is never < 0.
    expect(await isFresh("react-patterns", 0)).toBe(false);
    expect(await isFresh("react-patterns", 60_000)).toBe(true);
  });

  it("clearCache empties the cache directory", async () => {
    await recordInstall("a");
    await recordInstall("b");
    const before = await listCached();
    expect(before).toHaveLength(2);

    const { removed } = await clearCache();
    expect(removed).toBe(2);

    const after = await listCached();
    expect(after).toHaveLength(0);
  });

  it("listCached sorts oldest first and flags fresh/stale", async () => {
    await recordInstall("old-skill");
    const metaFile = path.join(getCacheRoot(), "old-skill", "meta.json");
    const staleMeta = JSON.parse(await fs.readFile(metaFile, "utf8"));
    staleMeta.cachedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(metaFile, JSON.stringify(staleMeta));

    await recordInstall("new-skill");

    const list = await listCached();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("old-skill");
    expect(list[0].fresh).toBe(false);
    expect(list[1].name).toBe("new-skill");
    expect(list[1].fresh).toBe(true);
  });

  it("sanitizes skill names for directory paths (no shell-sensitive chars)", async () => {
    await recordInstall("weird/name with spaces");
    const entries = await fs.readdir(getCacheRoot());
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toContain("/");
    expect(entries[0]).not.toContain(" ");
  });

  it("DEFAULT_TTL_MS is 7 days", () => {
    expect(DEFAULT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
