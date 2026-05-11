import { describe, expect, it, afterEach } from "vitest";
import { createServer } from "node:net";
import { isPortAvailable, findAvailablePort } from "../../src/utils/port-check.js";

describe("utils/port-check", () => {
  const openServers = [];

  afterEach(async () => {
    for (const s of openServers) {
      await new Promise((resolve) => s.close(resolve));
    }
    openServers.length = 0;
  });

  async function occupy(port) {
    return new Promise((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(port, () => {
        openServers.push(s);
        resolve(s);
      });
    });
  }

  it("reports a free port as available", async () => {
    // Pick a port likely free by asking the OS; then verify it's available.
    const probe = await new Promise((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(0, () => {
        const { port } = s.address();
        s.close(() => resolve(port));
      });
    });
    expect(await isPortAvailable(probe)).toBe(true);
  });

  it("reports a busy port as unavailable", async () => {
    const server = await occupy(0);
    const { port } = server.address();
    expect(await isPortAvailable(port)).toBe(false);
  });

  it("findAvailablePort returns the same port when free", async () => {
    const probe = await new Promise((resolve) => {
      const s = createServer();
      s.listen(0, () => {
        const { port } = s.address();
        s.close(() => resolve(port));
      });
    });
    expect(await findAvailablePort(probe)).toBe(probe);
  });

  it("findAvailablePort skips busy ports and returns next free", async () => {
    // Occupy two consecutive ports
    const s1 = await occupy(0);
    const port = s1.address().port;
    const s2 = await occupy(port + 1).catch(() => null);
    const onBusy = [];
    const found = await findAvailablePort(port, 10, (p) => onBusy.push(p));
    expect(found).toBeGreaterThan(port);
    expect(onBusy).toContain(port);
    if (s2) expect(onBusy).toContain(port + 1);
  });

  it("findAvailablePort throws when no port is free in the range", async () => {
    const s = await occupy(0);
    const port = s.address().port;
    await expect(findAvailablePort(port, 1)).rejects.toThrow(/No available port/);
  });
});
