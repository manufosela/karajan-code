// C0 (KJC-TSK-0776, ADR 0007) — console.config.json v1: the ONE contract the
// instance brings. Validated fail-loud at load: a config the console cannot
// honour is an error, never a permissive start. Roles live here (git), not
// in a database; every principal must belong to an allowed domain.
import { readFileSync } from "node:fs";
import * as v from "valibot";

const NonEmpty = v.pipe(v.string(), v.minLength(1));
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const Domain = v.pipe(v.string(), v.regex(DOMAIN, "not a domain"));
const Principal = v.pipe(v.string(), v.regex(/^(@[a-z0-9.-]+\.[a-z]{2,}|[^@\s]+@[a-z0-9.-]+\.[a-z]{2,})$/i, "principal must be user@domain or @domain"));
const Repo = v.pipe(v.string(), v.regex(/^[\w.-]+\/[\w.-]+$/, "repo must be owner/name"));

const Corpus = v.object({ id: NonEmpty, name: v.optional(v.string()), adapter: v.literal("gcp-cloud-run"), project: NonEmpty, region: NonEmpty, service: NonEmpty, healthPath: v.optional(v.string(), "/health") });
const Operation = v.object({ id: NonEmpty, adapter: v.literal("github-workflow"), repo: Repo, workflow: NonEmpty, ref: v.optional(v.string(), "main"), roles: v.optional(v.array(v.picklist(["operator", "admin"])), ["operator"]) });
const Secret = v.variant("adapter", [
  v.object({ id: NonEmpty, adapter: v.literal("gcp-secret-manager"), project: NonEmpty, name: NonEmpty }),
  v.object({ id: NonEmpty, adapter: v.literal("github-secret"), repo: Repo, name: NonEmpty }),
]);
const ConfigRepo = v.object({ adapter: v.literal("config-repo"), repo: Repo, path: NonEmpty, base: v.optional(v.string(), "main"), watchVersion: NonEmpty });
const Audit = v.variant("sink", [
  v.object({ sink: v.literal("file"), path: NonEmpty }),
  v.object({ sink: v.literal("gcs-jsonl"), bucket: NonEmpty }),
  v.object({ sink: v.literal("memory") }),
]);

export const ConsoleConfigSchema = v.object({
  version: v.optional(v.literal(1), 1),
  instance: v.object({ name: NonEmpty, project: v.optional(NonEmpty), allowedDomains: v.pipe(v.array(Domain), v.minLength(1, "allowedDomains must name at least one domain")) }),
  auth: v.object({ provider: v.literal("google"), audience: v.optional(v.string()) }),
  roles: v.object({ admins: v.pipe(v.array(Principal), v.minLength(1, "at least one admin")), operators: v.optional(v.array(Principal), []), readers: v.optional(v.array(Principal), []) }),
  corpora: v.optional(v.array(Corpus), []),
  operations: v.optional(v.array(Operation), []),
  secrets: v.optional(v.array(Secret), []),
  configRepo: v.optional(ConfigRepo),
  // GitHub App of the console (C2+): ids here, the private key from the environment — never in git.
  github: v.optional(v.object({ appId: v.union([NonEmpty, v.number()]), installationId: v.union([NonEmpty, v.number()]) })),
  audit: Audit,
});

export class ConsoleConfigError extends Error {
  constructor(problems) {
    super(`console.config.json is not valid:\n- ${problems.join("\n- ")}`);
    this.name = "ConsoleConfigError";
    this.problems = problems;
  }
}

const domainOf = (principal) => principal.slice(principal.lastIndexOf("@") + 1).toLowerCase();
const dup = (items, what) => {
  const seen = new Set();
  return items.filter((x) => (seen.has(x.id) ? true : (seen.add(x.id), false))).map((x) => `duplicate ${what} id "${x.id}"`);
};

/** Structural (valibot) + semantic checks. Throws ConsoleConfigError with EVERY problem. */
export function parseConsoleConfig(raw) {
  const res = v.safeParse(ConsoleConfigSchema, raw);
  if (!res.success) throw new ConsoleConfigError(res.issues.map((i) => `${(i.path || []).map((p) => p.key).join(".") || "root"}: ${i.message}`));
  const c = res.output;
  const domains = new Set(c.instance.allowedDomains.map((d) => d.toLowerCase()));
  const problems = [];
  for (const [role, list] of Object.entries(c.roles)) {
    for (const p of list) if (!domains.has(domainOf(p))) problems.push(`roles.${role}: "${p}" is outside allowedDomains (${[...domains].join(", ")})`);
  }
  problems.push(...dup(c.corpora, "corpus"), ...dup(c.operations, "operation"), ...dup(c.secrets, "secret"));
  if (problems.length) throw new ConsoleConfigError(problems);
  return c;
}

export function loadConsoleConfig(file) {
  let raw;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (err) { throw new ConsoleConfigError([`${file}: ${err.message}`]); }
  return parseConsoleConfig(raw);
}

/** admin > operator > reader; null when the email is outside the allowed domains or matches no role. */
export function resolveRole(config, email) {
  const e = String(email || "").toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0 || !config.instance.allowedDomains.some((d) => d.toLowerCase() === e.slice(at + 1))) return null;
  const matches = (list) => list.some((p) => (p.startsWith("@") ? p.toLowerCase() === e.slice(at) : p.toLowerCase() === e));
  if (matches(config.roles.admins)) return "admin";
  if (matches(config.roles.operators)) return "operator";
  if (matches(config.roles.readers)) return "reader";
  return null;
}
