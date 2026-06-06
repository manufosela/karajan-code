// Tiny ULID generator (Crockford base32, 26 chars, monotonic within ms).
// We keep this self-contained to avoid pulling a runtime dep into the
// safety-net package — fewer transitive deps = fewer supply-chain surfaces
// that an attacker could pivot through to reach the trash store.

import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastMs = 0;
let lastRandom = new Uint8Array(10);

function encodeTime(ms) {
  let out = "";
  for (let i = 9; i >= 0; i--) {
    out = ENCODING[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function encodeRandom(bytes) {
  let out = "";
  for (let i = 0; i < 16; i++) {
    const byteIndex = Math.floor((i * 5) / 8);
    const bitOffset = (i * 5) % 8;
    const hi = bytes[byteIndex] ?? 0;
    const lo = bytes[byteIndex + 1] ?? 0;
    const value = ((hi << 8) | lo) >> (11 - bitOffset);
    out += ENCODING[value & 31];
  }
  return out;
}

function bumpRandom(buf) {
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i] === 0xff) {
      buf[i] = 0;
      continue;
    }
    buf[i] += 1;
    return buf;
  }
  throw new Error("ulid: random overflow within the same millisecond");
}

export function ulid(nowMs = Date.now()) {
  if (nowMs === lastMs) {
    lastRandom = bumpRandom(lastRandom);
  } else {
    lastMs = nowMs;
    lastRandom = new Uint8Array(randomBytes(10));
  }
  return encodeTime(nowMs) + encodeRandom(lastRandom);
}

export function decodeTimeFromUlid(id) {
  const slice = id.slice(0, 10);
  let ms = 0;
  for (const ch of slice) {
    const v = ENCODING.indexOf(ch);
    if (v < 0) throw new Error(`ulid: invalid char ${ch}`);
    ms = ms * 32 + v;
  }
  return ms;
}
