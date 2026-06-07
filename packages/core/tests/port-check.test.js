// Smoke coverage for the @karajan/core/port-check extraction
// (KJC-TSK-0511 PR2). Real socket binding — tiny but fast.
import { createServer } from "node:net";
import { describe, it, expect } from "vitest";

import { isPortAvailable, findAvailablePort } from "../src/port-check.js";

function occupy() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

describe("@karajan/core/port-check", () => {
  it("isPortAvailable returns false for a port we already bound", async () => {
    const { srv, port } = await occupy();
    try {
      expect(await isPortAvailable(port)).toBe(false);
    } finally {
      srv.close();
    }
  });

  it("findAvailablePort skips busy ports and returns the next free one", async () => {
    const { srv, port } = await occupy();
    try {
      const got = await findAvailablePort(port, 5);
      expect(got).toBeGreaterThan(port);
    } finally {
      srv.close();
    }
  });

  it("findAvailablePort throws when the range is exhausted", async () => {
    const occupied = [];
    for (let i = 0; i < 3; i += 1) occupied.push(await occupy());
    const ports = occupied.map((o) => o.port).sort((a, b) => a - b);
    try {
      const gap = ports[2] - ports[0];
      if (gap > 2) return;
      await expect(findAvailablePort(ports[0], gap + 1)).rejects.toThrow(/No available port/);
    } finally {
      for (const { srv } of occupied) srv.close();
    }
  });
});
