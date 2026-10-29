/**
 * published-pin — the karajan-code version a seeded workflow may pin (KJC-BUG-0420).
 *
 * A consumer repo's CI installs kj from npm, so the pin must be a published
 * version. A checkout ahead of npm pins the newest published version that is
 * not newer than itself; when the registry cannot confirm anything, the
 * running version stays and the note says so.
 */

import { isNewerVersion } from "../utils/update-check.js";

const packumentUrl = (name) => `https://registry.npmjs.org/${encodeURIComponent(name)}`;

async function publishedVersions(name, fetchFn) {
  const res = await fetchFn(packumentUrl(name), { headers: { Accept: "application/vnd.npm.install-v1+json" } });
  if (!res.ok) throw new Error(`registry responded ${res.status}`);
  return Object.keys((await res.json()).versions ?? {});
}

/** @returns {Promise<{version: string, note?: string}>} */
export async function publishedPin({ name, version, fetchFn = fetch }) {
  const unconfirmed = (why) => ({ version, note: `could not confirm on npm that ${name}@${version} is published (${why}); the workflow pins it as is` });
  let published;
  try {
    published = await publishedVersions(name, fetchFn);
  } catch (err) {
    return unconfirmed(err.message);
  }
  if (published.includes(version)) return { version };
  const older = published.filter((v) => !v.includes("-") && !isNewerVersion(v, version));
  const newest = older.reduce((best, v) => (best && !isNewerVersion(v, best) ? best : v), null);
  if (!newest) return unconfirmed("no published version at or below it");
  return { version: newest, note: `${name}@${version} is not on npm yet; the workflow pins ${newest}, the newest published one` };
}
