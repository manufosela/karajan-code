// KJC-TSK-0986 (HUM-F, ADR 0018): whoever runs kj without a phone enrolled learns
// it once per version, with what the signature protects and how to enroll.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PHONE_INVITE, createPhoneCheck, phoneInvite } from "../../src/harden/phone-invite.js";

let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-phone-invite-")); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const enroll = () => {
  fs.mkdirSync(path.join(home, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(home, ".karajan", "supervisor-phone.json"), JSON.stringify({ publicKey: "x" }));
};

describe("phoneInvite", () => {
  it("invites once per version when no phone is enrolled, and remembers it", () => {
    expect(phoneInvite({ home, version: "4.44.0" })).toBe(PHONE_INVITE);
    expect(PHONE_INVITE).toMatch(/kj identity enroll-phone/);
    expect(PHONE_INVITE).toMatch(/código tecleado/); // how one proceeds today without it
    expect(phoneInvite({ home, version: "4.44.0" })).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(home, ".karajan", "phone-invite.json"), "utf8")).version).toBe("4.44.0");
    expect(phoneInvite({ home, version: "4.45.0" })).toBe(PHONE_INVITE); // a new version asks again
  });

  it("says nothing once the phone is enrolled", () => {
    enroll();
    expect(phoneInvite({ home, version: "4.44.0" })).toBeNull();
    expect(fs.existsSync(path.join(home, ".karajan", "phone-invite.json"))).toBe(false);
  });
});

describe("kj doctor check", () => {
  it("warns with the same text while the phone is not enrolled, ok once it is", async () => {
    const warn = await createPhoneCheck({ home }).detect();
    expect(warn).toMatchObject({ ok: false, severity: "warn", detail: PHONE_INVITE });
    expect(warn.fix).toMatch(/kj identity enroll-phone/);
    enroll();
    expect(await createPhoneCheck({ home }).detect()).toMatchObject({ ok: true });
  });
});
