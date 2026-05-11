import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn(() => "/home/user/.karajan")
}));

const { readFile, writeFile, mkdir } = await import("node:fs/promises");
const { DomainRegistry } = await import("../src/domains/domain-registry.js");

describe("DomainRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
  });

  describe("load", () => {
    it("creates empty registry when file does not exist", async () => {
      readFile.mockRejectedValue(new Error("ENOENT"));

      const registry = await DomainRegistry.load();

      expect(registry).toBeInstanceOf(DomainRegistry);
      expect(registry.list()).toEqual([]);
    });

    it("loads existing registry from disk", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        schemaVersion: 1,
        domains: {
          "dental-clinical": {
            name: "dental-clinical",
            version: "1.0.0",
            source: "local",
            installedAt: "2026-03-01T00:00:00Z",
            filePath: "/home/user/.karajan/domains/dental/DOMAIN.md",
            tags: ["dental", "clinical"]
          }
        }
      }));

      const registry = await DomainRegistry.load();
      const all = registry.list();

      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("dental-clinical");
      expect(all[0].tags).toEqual(["dental", "clinical"]);
    });

    it("handles malformed JSON gracefully", async () => {
      readFile.mockResolvedValue("not valid json {{{");

      const registry = await DomainRegistry.load();

      expect(registry.list()).toEqual([]);
    });
  });

  describe("register", () => {
    it("adds a new domain to the registry", async () => {
      readFile.mockRejectedValue(new Error("ENOENT"));
      const registry = await DomainRegistry.load();

      registry.register({
        name: "dental-clinical",
        version: "1.0.0",
        tags: ["dental", "clinical"],
        filePath: "/path/to/DOMAIN.md"
      });

      const all = registry.list();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("dental-clinical");
      expect(all[0].source).toBe("local");
      expect(all[0].installedAt).toBeDefined();
    });

    it("updates an existing domain by name", async () => {
      readFile.mockRejectedValue(new Error("ENOENT"));
      const registry = await DomainRegistry.load();

      registry.register({ name: "dental", version: "1.0.0", tags: ["dental"], filePath: "/v1" });
      registry.register({ name: "dental", version: "2.0.0", tags: ["dental", "updated"], filePath: "/v2" });

      const all = registry.list();
      expect(all).toHaveLength(1);
      expect(all[0].version).toBe("2.0.0");
      expect(all[0].tags).toEqual(["dental", "updated"]);
      expect(all[0].filePath).toBe("/v2");
    });
  });

  describe("save", () => {
    it("persists registry to disk", async () => {
      readFile.mockRejectedValue(new Error("ENOENT"));
      const registry = await DomainRegistry.load();

      registry.register({ name: "dental", version: "1.0.0", tags: ["dental"], filePath: "/path" });
      await registry.save();

      expect(mkdir).toHaveBeenCalledWith("/home/user/.karajan", { recursive: true });
      expect(writeFile).toHaveBeenCalledTimes(1);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written.schemaVersion).toBe(1);
      expect(written.domains.dental).toBeDefined();
      expect(written.domains.dental.name).toBe("dental");
    });
  });

  describe("list", () => {
    it("filters by tags", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        schemaVersion: 1,
        domains: {
          dental: { name: "dental", tags: ["dental", "clinical"], version: "1.0.0", source: "local", installedAt: "", filePath: "" },
          logistics: { name: "logistics", tags: ["logistics", "shipping"], version: "1.0.0", source: "local", installedAt: "", filePath: "" }
        }
      }));

      const registry = await DomainRegistry.load();

      const filtered = registry.list({ tags: ["dental"] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("dental");
    });

    it("filters by query (free-text search on name + description)", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        schemaVersion: 1,
        domains: {
          dental: { name: "dental-clinical", description: "Dental workflows", tags: [], version: "1.0.0", source: "local", installedAt: "", filePath: "" },
          logistics: { name: "logistics", description: "Shipping and transport", tags: [], version: "1.0.0", source: "local", installedAt: "", filePath: "" }
        }
      }));

      const registry = await DomainRegistry.load();

      const byName = registry.list({ query: "dental" });
      expect(byName).toHaveLength(1);

      const byDesc = registry.list({ query: "shipping" });
      expect(byDesc).toHaveLength(1);
      expect(byDesc[0].name).toBe("logistics");
    });

    it("returns all when no filters", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        schemaVersion: 1,
        domains: {
          a: { name: "a", tags: [], version: "1.0.0", source: "local", installedAt: "", filePath: "" },
          b: { name: "b", tags: [], version: "1.0.0", source: "local", installedAt: "", filePath: "" }
        }
      }));

      const registry = await DomainRegistry.load();
      expect(registry.list()).toHaveLength(2);
    });
  });

  describe("search", () => {
    it("matches domains by hints against tags, name and description", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        schemaVersion: 1,
        domains: {
          dental: { name: "dental-clinical", description: "Clinical dental workflows", tags: ["dental", "clinical", "orthodontics"], version: "1.0.0", source: "local", installedAt: "", filePath: "" },
          logistics: { name: "logistics", description: "Shipping and transport rules", tags: ["logistics", "shipping"], version: "1.0.0", source: "local", installedAt: "", filePath: "" },
          finance: { name: "finance", description: "Accounting rules", tags: ["finance", "accounting"], version: "1.0.0", source: "local", installedAt: "", filePath: "" }
        }
      }));

      const registry = await DomainRegistry.load();

      const results = registry.search(["dental", "clinical"]);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("dental-clinical");
    });

    it("returns empty array when no hints match", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        schemaVersion: 1,
        domains: {
          dental: { name: "dental", tags: ["dental"], version: "1.0.0", source: "local", installedAt: "", filePath: "" }
        }
      }));

      const registry = await DomainRegistry.load();

      expect(registry.search(["aerospace"])).toEqual([]);
    });

    it("returns empty array for empty hints", async () => {
      readFile.mockRejectedValue(new Error("ENOENT"));
      const registry = await DomainRegistry.load();

      expect(registry.search([])).toEqual([]);
    });

    it("ranks results by number of matching hints", async () => {
      readFile.mockResolvedValue(JSON.stringify({
        schemaVersion: 1,
        domains: {
          generic: { name: "generic-health", description: "General health domain", tags: ["health"], version: "1.0.0", source: "local", installedAt: "", filePath: "" },
          dental: { name: "dental-clinical", description: "Clinical dental workflows", tags: ["dental", "clinical", "health"], version: "1.0.0", source: "local", installedAt: "", filePath: "" }
        }
      }));

      const registry = await DomainRegistry.load();

      const results = registry.search(["dental", "clinical", "health"]);
      expect(results.length).toBeGreaterThanOrEqual(1);
      // dental-clinical should rank first (3 matches vs 1)
      expect(results[0].name).toBe("dental-clinical");
    });
  });
});
