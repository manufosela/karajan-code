/**
 * published-pin — the karajan-code version a seeded workflow may pin (KJC-BUG-0420).
 *
 * A consumer repo's CI installs kj from npm, so the pin must be a published
 * version. A checkout ahead of npm pins the newest published version that is
 * not newer than itself; when the registry cannot be read nothing is pinned
 * (HU-4278): the workflows that install kj are left as they are, with a note.
 */

import { isNewerVersion } from "../utils/update-check.js";

const packumentUrl = (name) => `https://registry.npmjs.org/${encodeURIComponent(name)}`;

async function publishedVersions(name, fetchFn) {
  const res = await fetchFn(packumentUrl(name), { headers: { Accept: "application/vnd.npm.install-v1+json" } });
  if (!res.ok) throw new Error(`registry responded ${res.status}`);
  return Object.keys((await res.json()).versions ?? {});
}

const stable = (versions) => versions.filter((v) => !v.includes("-"));
const newest = (versions) => versions.reduce((best, v) => (best && !isNewerVersion(v, best) ? best : v), null);

/**
 * HU-4278: the pin of one workflow, the newest published version within [min, running].
 * `published` undefined = no registry check was asked (the running version stands);
 * null = the registry could not be read (nothing is pinned); no match = null as well.
 */
export function pinForMinimum({ published, running, min }) {
  if (published === undefined) return running;
  if (published === null) return null;
  return newest(stable(published).filter((v) => !isNewerVersion(v, running) && (!min || !isNewerVersion(min, v))));
}

/** @returns {Promise<{version: string|null, published: string[]|null, note?: string}>} */
export async function publishedPin({ name, version, fetchFn = fetch }) {
  let published;
  try {
    published = await publishedVersions(name, fetchFn);
  } catch (err) {
    // HU-4278: never pin what could not be confirmed; the workflows that install kj stay as they are.
    return { version: null, published: null, note: `could not confirm the published ${name} versions on npm (${err.message}); the workflows that install it are left as they are` };
  }
  if (published.includes(version)) return { version, published };
  const pinned = newest(stable(published).filter((v) => !isNewerVersion(v, version)));
  if (!pinned) return { version: null, published };
  return { version: pinned, published, note: `${name}@${version} is not on npm yet; each workflow pins the newest published version it accepts (at most ${pinned})` };
}
