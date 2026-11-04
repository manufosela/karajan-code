/**
 * HU-3333 (epic #3332, ADR 0029): what every task manager (GitHub Issues, Linear...) must offer.
 *
 *   create({ title, acceptanceCriteria, tests, ref }) -> Hu
 *   list()                      -> Hu[]
 *   move(id, status)            -> Hu     (read back after writing)
 *   claim(id, who, { release }) -> Hu
 *
 * Optional, the id format of the manager (the core never assumes HU-<n>):
 *   isId(ref)        -> boolean  (is this text one of my ids; no manager matching = refused loud)
 *   canonicalId(ref) -> string   (the id as list() returns it; default: the ref as typed)
 *   idHint           -> string   (how an id looks, for messages)
 *
 * Declared by every manager (HU-3337, ADR 0029): what it can show and manage, so kj says so.
 *   capabilities { acceptanceCriteria: field|body, dependencies: none|partial|graph, assignee: boolean,
 *                  verdicts: pr|comment|none, offline: boolean (works through the core cache) }
 *   credentials  string[]  (optional) names of the environment variables it needs; [] when none
 */
export const OPERATIONS = ["create", "list", "move", "claim"];
export const CAPABILITY_VALUES = {
  acceptanceCriteria: ["field", "body"],
  dependencies: ["none", "partial", "graph"],
  assignee: [true, false],
  verdicts: ["pr", "comment", "none"],
  offline: [true, false],
};
/** The fields of an Hu, whatever manager it comes from. */
export const HU_FIELDS = ["short_id", "title", "status", "claimed_by", "ref"];

/** Fail loud, naming what is missing, instead of at the first call that needs it. */
export function assertManager(manager) {
  if (manager === null || typeof manager !== "object") throw new TypeError("task manager must be an object with the story operations");
  const missing = OPERATIONS.filter((op) => typeof manager[op] !== "function");
  if (missing.length > 0) throw new TypeError(`task manager is missing ${missing.join(", ")}: it must offer ${OPERATIONS.join(", ")}`);
  const declared = manager.capabilities;
  if (declared === null || typeof declared !== "object") throw new TypeError(`task manager must declare its capabilities: ${Object.keys(CAPABILITY_VALUES).join(", ")}`);
  for (const [name, allowed] of Object.entries(CAPABILITY_VALUES)) {
    if (!allowed.includes(declared[name])) throw new TypeError(`task manager capability ${name} is ${JSON.stringify(declared[name]) ?? "missing"}: it must be one of ${allowed.join(", ")}`);
  }
  const { credentials } = manager;
  if (credentials !== undefined && !(Array.isArray(credentials) && credentials.every((n) => typeof n === "string" && n !== ""))) {
    throw new TypeError("task manager credentials must be a list of environment variable names");
  }
}

const CRITERIA_AT = { field: "in their own field", body: "in the story body" };
/** What the manager can do and what it cannot, in words for the user. */
export function describeCapabilities({ capabilities: c }) {
  const can = [`acceptance criteria ${CRITERIA_AT[c.acceptanceCriteria]}`];
  const cannot = [];
  if (c.dependencies !== "none") can.push(c.dependencies === "graph" ? "the dependency graph" : "some dependencies between stories");
  if (c.dependencies !== "graph") cannot.push("the full dependency graph");
  (c.assignee ? can : cannot).push("who holds a story");
  if (c.verdicts === "none") cannot.push("review verdicts");
  else can.push(`review verdicts ${c.verdicts === "pr" ? "on the PR" : "as a comment"}`);
  (c.offline ? can : cannot).push("work offline through the core cache");
  return { can, cannot };
}

/** The credential variables the manager needs and the environment lacks: names only, values are never read out. */
export const missingCredentials = (manager, env = process.env) => (manager.credentials ?? []).filter((name) => !env[name]);

/** The lines `kj hu backend` prints: what is possible, and for each thing that is not, where to see it. */
export function capabilityLines(manager) {
  const { can, cannot } = describeCapabilities(manager);
  return [`  can: ${can.join("; ")}`, ...cannot.map((item) => `  cannot: ${item} — see it in the HU Board (kj board start)`)];
}
