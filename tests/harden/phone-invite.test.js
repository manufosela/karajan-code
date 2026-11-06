// KJC-TSK-0986 (HUM-F, ADR 0018): whoever runs kj without a phone enrolled learns
// it once per version, with what the signature protects and how to enroll.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PHONE_ENROLL, PHONE_INVITE, PHONE_REFUSED_AT_MAX, createPhoneCheck, phoneInvite } from "../../src/harden/phone-invite.js";
import { SUPERVISOR_DEFAULTS } from "../../src/policy/engine.js";

const GOVERNANCE_DENY = SUPERVISOR_DEFAULTS.find((r) => r.id === "defaults.governance.write")?.message;

let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-phone-invite-")); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const enroll = () => {
  fs.mkdirSync(path.join(home, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(home, ".karajan", "supervisor-phone.json"), JSON.stringify({ publicKey: "x" }));
};

describe("phoneInvite", () => {
  it("invites once per version when no phone is enrolled, and remembers it", () => {
    expect(phoneInvite({ home, version: "4.44.0", level: "normal" })).toBe(PHONE_INVITE);
    expect(PHONE_INVITE).toMatch(/kj identity enroll-phone/);
    expect(PHONE_INVITE).toMatch(/código tecleado/); // how one proceeds at the normal level
    expect(phoneInvite({ home, version: "4.44.0" })).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(home, ".karajan", "phone-invite.json"), "utf8")).version).toBe("4.44.0");
    expect(phoneInvite({ home, version: "4.45.0" })).toBe(PHONE_REFUSED_AT_MAX); // a new version asks again, at max by default
    expect(PHONE_REFUSED_AT_MAX).toMatch(/kj identity enroll-phone/);
  });

  // KJC-BUG-0508: whoever updated kj never ran init, so the refusal is where they learn the way out.
  it("every text a person without a phone reads says where the phone app is, and the other way out", () => {
    for (const text of [PHONE_INVITE, PHONE_REFUSED_AT_MAX, PHONE_ENROLL, GOVERNANCE_DENY]) {
      expect(text).toMatch(/karajancode\.com\/sign/);
      expect(text).toMatch(/kj identity enroll-phone/);
    }
    expect(PHONE_REFUSED_AT_MAX).toMatch(/kj security normal/);
    expect(GOVERNANCE_DENY).toMatch(/kj security normal/);
  });

  it("says nothing once the phone is enrolled", () => {
    enroll();
    expect(phoneInvite({ home, version: "4.44.0" })).toBeNull();
    expect(fs.existsSync(path.join(home, ".karajan", "phone-invite.json"))).toBe(false);
  });
});

describe("kj doctor check", () => {
  it("at the normal level it warns: the acts are signed with a typed code", async () => {
    const warn = await createPhoneCheck({ home, readLevel: () => "normal" }).detect();
    expect(warn).toMatchObject({ ok: false, severity: "warn" });
    expect(warn.detail).toMatch(/código tecleado/);
    expect(warn.fix).toMatch(/kj identity enroll-phone/);
    enroll();
    expect(await createPhoneCheck({ home, readLevel: () => "normal" }).detect()).toMatchObject({ ok: true });
  });

  // KJC-BUG-0360 (field, 15-oct): at the max level, the default, the acts are
  // REFUSED without a phone; doctor listed it as optional and the text spoke of a typed code.
  it("at the max level it fails, naming what is refused, and never speaks of a typed code", async () => {
    const fail = await createPhoneCheck({ home, readLevel: () => "max" }).detect();
    expect(fail).toMatchObject({ ok: false, severity: "fail" });
    expect(fail.detail).toMatch(/se rechazan/);
    expect(fail.detail).toMatch(/kj harden --commit/);
    expect(fail.detail).not.toMatch(/código tecleado/);
    expect(fail.fix).toMatch(/kj identity enroll-phone/);
  });

  it("without a level file the project is at max, so the check reads it as max", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-phone-level-"));
    expect(await createPhoneCheck({ home, projectDir }).detect()).toMatchObject({ severity: "fail" });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });
});
