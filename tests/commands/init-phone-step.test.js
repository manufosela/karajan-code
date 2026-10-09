// KJC-TSK-0997 (HUM-D4, ADR 0018): kj init explains the phone, what it protects and how to enroll it.
import { expect, it } from "vitest";

import { tellPhoneStep } from "../../src/commands/init.js";

const lines = (enrolled) => { const out = []; tellPhoneStep({ info: (l) => out.push(l) }, { enrolled }); return out.join("\n"); };

it("without a phone: what is refused, the page, the command from the user's terminal, the recovery code, and the way down", () => {
  const text = lines(false);
  expect(text).toMatch(/level is max by default.*refused until one is enrolled/s);
  expect(text).toMatch(/karajancode\.com\/sign/);
  expect(text).toMatch(/never from an agent session: kj identity enroll-phone <public key>/);
  expect(text).toMatch(/recovery code.*--recovery <code>/);
  expect(text).toMatch(/kj security normal lowers the level, signed from the phone too/);
});

it("with a phone: says the level is max and what is signed from it", () => {
  expect(lines(true)).toMatch(/A phone is enrolled.*max by default.*kj security show/s);
});
