/**
 * Plugin sources (ADR 0021, plan step 13a1): every source a marketplace of those CLIs
 * accepts — owner/repo[#ref], a git URL, a local path, a hosted marketplace.json, and the
 * object forms of a Claude Code marketplace entry — normalized to { type, … }; and the
 * cache paths of a plugin copy. Reading only.
 */
import { join } from "node:path";
import { isMapping } from "./model.js";
import { SAFE_NAME } from "./plugin.js";

// owner/repo, neither of them "." or "..".
const REPO = /^(?!\.{1,2}\/)[\w.-]+\/(?!\.{1,2}$)[\w.-]+$/;
// A ref never starts with "-" (git would read it as an option) nor holds "..".
const REF = /^(?!-)(?!.*\.\.)[\w./-]+$/;
const GIT_URL = /^(https?:\/\/|ssh:\/\/|git@)\S+$/;
// Lowercase, as lock.js stores a commit.
const COMMIT = /^[0-9a-f]{40}$/;
// A folder inside a repo: relative, "/"-separated segments, none of them "." or "..".
const SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;
const isSubdir = (path) => typeof path === "string" && path.split("/").every((segment) => SEGMENT.test(segment));
// A version is one path segment: no separators, and never "." or "..".
const VERSION = /^(?!\.+$)[\w.+-]+$/;

const unknown = (spec) => new Error(`unknown plugin source: ${JSON.stringify(spec)}`);
// The ref is optional; when given (even "#" with nothing after it) it must be a valid one.
const withRef = (spec, value, ref) => {
  if (ref === undefined) return value;
  if (typeof ref !== "string" || !REF.test(ref)) throw unknown(spec);
  return { ...value, ref };
};

const parseString = (spec) => {
  if (/^(\.{1,2}\/|\/)/.test(spec)) return { type: "path", path: spec };
  if (/^https?:\/\/\S+\.json$/.test(spec)) return { type: "marketplace-url", url: spec };
  const [target, ref] = spec.split(/#(.*)/s, 2);
  if (GIT_URL.test(target)) return withRef(spec, { type: "git", url: target }, ref);
  if (REPO.test(target)) return withRef(spec, { type: "github", repo: target }, ref);
  throw unknown(spec);
};

// RegExp.test coerces its argument, so a field is checked to be a string first.
const matches = (pattern, value) => typeof value === "string" && pattern.test(value);

// The pin a marketplace entry carries: absent, or exactly a full commit hash.
const withPins = (spec, value) => {
  const pinned = withRef(spec, value, spec.ref);
  if (spec.sha === undefined) return pinned;
  if (!matches(COMMIT, spec.sha)) throw unknown(spec);
  return { ...pinned, commit: spec.sha };
};
const parseObject = (spec) => {
  if (spec.source === "github" && matches(REPO, spec.repo)) return withPins(spec, { type: "github", repo: spec.repo });
  if (spec.source === "url" && matches(GIT_URL, spec.url)) return withPins(spec, { type: "git", url: spec.url });
  if (spec.source === "git-subdir" && matches(GIT_URL, spec.url) && isSubdir(spec.path)) return withPins(spec, { type: "git-subdir", url: spec.url, path: spec.path });
  throw unknown(spec);
};

export function parsePluginSource(spec) {
  if (typeof spec === "string") return parseString(spec);
  if (isMapping(spec)) return parseObject(spec);
  throw unknown(spec);
}

export function pluginPaths(root, name, version) {
  if (typeof name !== "string" || !SAFE_NAME.test(name)) throw new Error(`invalid plugin name: ${JSON.stringify(name)}`);
  if (typeof version !== "string" || !VERSION.test(version)) throw new Error(`invalid plugin version: ${JSON.stringify(version)}`);
  const base = join(root, "plugins", name);
  return { base, dir: join(base, version) };
}
