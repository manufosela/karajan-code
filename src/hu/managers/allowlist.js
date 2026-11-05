/**
 * HU-3390: the `managers.allow` list of board.yml. A community task manager is third-party code that
 * runs with the agent's rights, so only a package named here, at an exact version, is ever imported.
 */
const NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const RESERVED = ["github", "linear", "local"];

/** The backend name a package answers to: no `@scope/`, no leading `board-` or `kj-board-`. */
export const backendOf = (packageName) => packageName.replace(/^@[^/]+\//, "").replace(/^(kj-)?board-/, "");

/** The validated entries of `managers.allow` as `{ name, version, backend }`; anything else fails loud. */
export function parseAllow(managers) {
  if (managers === undefined) return [];
  if (!Array.isArray(managers?.allow)) throw new TypeError("managers.allow must be a list of { name, version }");
  const seen = new Map();
  return managers.allow.map((item) => {
    const { name, version } = item ?? {};
    if (typeof name !== "string" || name.length > 214 || !NAME_RE.test(name)) throw new Error(`managers.allow: "${name}" is not an npm package name`);
    if (typeof version !== "string" || !EXACT_SEMVER.test(version)) throw new Error(`managers.allow: ${name} needs an exact version (like 1.2.3), got "${version}"`);
    const backend = backendOf(name);
    if (RESERVED.includes(backend)) throw new Error(`managers.allow: ${name} would shadow the built-in "${backend}"`);
    if (seen.has(backend)) throw new Error(`managers.allow: ${name} and ${seen.get(backend)} both map to the backend "${backend}"`);
    seen.set(backend, name);
    return { name, version, backend };
  });
}
