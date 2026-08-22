// C1-UI (KJC-TSK-0785, ADR 0007) — the page is served by the API itself (no
// build), status tells it the public OAuth client id and the domains, and an
// API-only deployment can switch the page off.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { parseConsoleConfig, createConsoleApp } from "@karajan-family/console";

const base = { instance: { name: "atlas", allowedDomains: ["example.com"] }, roles: { admins: ["admin@example.com"] }, audit: { sink: "memory" } };
const verify = async () => { throw new Error("never called here"); };

describe("console ui (C1-UI)", () => {
  it("serves the page and its assets from /, and status carries what the page needs to sign people in", async () => {
    const app = createConsoleApp({ config: parseConsoleConfig({ ...base, auth: { provider: "google", audience: "123.apps.googleusercontent.com" } }), verify });
    const page = await request(app).get("/");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.text).toContain("Karajan Console");
    expect((await request(app).get("/styles.css")).headers["content-type"]).toMatch(/text\/css/);
    expect((await request(app).get("/api/status")).body.auth).toEqual({ provider: "google", clientId: "123.apps.googleusercontent.com", domains: ["example.com"] });
    expect((await request(app).get("/api/nope")).status).toBe(404); // the page never shadows the API's 404
  });

  it("without an audience the page is told so (clientId null); ui:false keeps the process API-only", async () => {
    const config = parseConsoleConfig({ ...base, auth: { provider: "google" } });
    expect((await request(createConsoleApp({ config, verify })).get("/api/status")).body.auth.clientId).toBeNull();
    expect((await request(createConsoleApp({ config, verify, ui: false })).get("/")).status).toBe(404);
  });
});
