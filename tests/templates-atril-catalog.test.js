// KJC-TSK-1218 (ADR 0021, step 15b): Karajan's kj-* artifacts are a catalog in a store's
// layout, so atril reads and installs them like any other.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CATALOG = fileURLToPath(new URL("../templates/atril", import.meta.url));
const ATRIL = fileURLToPath(new URL("../packages/atril/bin/atril.js", import.meta.url));

describe("templates/atril, Karajan's catalog", () => {
  it("scans as a valid atril store holding every kj-* command, and nothing else", () => {
    const noUserStore = mkdtempSync(join(tmpdir(), "kj-catalog-user-"));
    try {
      const out = execFileSync(process.execPath, [ATRIL, "scan", "--root", CATALOG, "--json"], {
        encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: noUserStore },
      });
      const { artifacts } = JSON.parse(out);
      const files = readdirSync(join(CATALOG, "commands")).map((file) => file.replace(/\.md$/, ""));
      expect(artifacts.map(({ kind, name }) => `${kind}:${name}`).toSorted()).toEqual(files.toSorted().map((name) => `command:${name}`));
      expect(files).toHaveLength(14);
      expect(files.every((name) => name.startsWith("kj-"))).toBe(true);
    } finally {
      rmSync(noUserStore, { recursive: true, force: true });
    }
  });
});
