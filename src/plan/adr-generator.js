/**
 * Architecture Decision Records (ADRs) — distill the architect role's
 * tradeoffs[] output into the canonical "Context · Decision ·
 * Consequences · Status" markdown format.
 *
 * Why ADRs as a first-class artifact (v2.7.5):
 *   - The architect already analyses the task and produces a
 *     `tradeoffs[]` list with `{ decision, rationale, alternatives }`.
 *     That data is exactly what an ADR captures, just unformatted.
 *   - An ADR persists the WHY of an architectural choice. Coder and
 *     reviewer in the next `kj run` can pull the active ADRs into
 *     their prompt for context.
 *   - It's also a deliverable in its own right — projects benefit
 *     from a `docs/adr/` history regardless of Karajan.
 *
 * Storage: per-plan under `~/.kj/plans/<slug>/adrs/<adr-id>.md` (so
 * an ADR's lifecycle matches its plan's). When the orchestrator runs
 * a plan, the coder gets the ADRs as context. When a plan is removed
 * (`kj plan delete`) the ADRs go with it.
 *
 * Format follows Michael Nygard's classic structure (the most widely
 * adopted in the industry, used by GitHub, Spotify, AWS docs, etc.).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { plansDir } from "./plan-store.js";

const VALID_ADR_STATUSES = new Set(["proposed", "accepted", "deprecated", "superseded"]);

/**
 * Slugify a decision title into a filesystem-safe ADR id fragment.
 * "Use SQLite for plan storage" → "use-sqlite-for-plan-storage".
 */
function slugifyTitle(title) {
  return String(title || "")
    .toLowerCase()
    // Decompose accents (NFD) then strip combining marks so "versión"
    // → "version", keeping the ADR id ASCII-only and filesystem-safe.
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .replaceAll(/[^a-z0-9\s-]/g, "")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 80) || "untitled";
}

/**
 * Turn the architect's `architecture.tradeoffs[]` into an array of
 * ADR objects. Each tradeoff carries `{ decision, rationale,
 * alternatives }`; we map them to the four ADR sections plus
 * metadata.
 *
 * Numbering: 1-based, zero-padded to 4 digits ("0001-…"). Stable per
 * call — callers should treat `id` as opaque (filename) and `number`
 * as ordinal.
 *
 * @param {object} architecture - parsed architect output
 * @param {object} [opts]
 * @param {string} [opts.status] - default "accepted" (architect runs imply the decision is taken)
 * @returns {Array<{ number: number, id: string, title: string, status: string,
 *                   context: string, decision: string, consequences: string,
 *                   alternatives: string[] }>}
 */
export function extractAdrsFromArchitecture(architecture, opts = {}) {
  const tradeoffs = Array.isArray(architecture?.tradeoffs) ? architecture.tradeoffs : [];
  const status = VALID_ADR_STATUSES.has(opts.status) ? opts.status : "accepted";
  const adrs = [];
  let n = 0;
  for (const t of tradeoffs) {
    if (!t || (typeof t !== "object" && typeof t !== "string")) continue;
    const title = typeof t === "string" ? t : (t.decision || t.title || "");
    if (!title.trim()) continue;
    n += 1;
    const number = n;
    const slug = slugifyTitle(title);
    const id = `${String(number).padStart(4, "0")}-${slug}`;
    adrs.push({
      number,
      id,
      title: title.trim(),
      status,
      context: typeof t === "object" && t.context ? String(t.context) : "",
      decision: typeof t === "object" && t.decision ? String(t.decision) : title.trim(),
      consequences: typeof t === "object" && t.rationale ? String(t.rationale) : "",
      alternatives: typeof t === "object" && Array.isArray(t.alternatives) ? t.alternatives.map(String) : [],
    });
  }
  return adrs;
}

/**
 * Render an ADR to markdown using Nygard's format. Newline-stable so
 * tests can do exact-match assertions.
 *
 * @param {object} adr
 * @param {object} [opts]
 * @param {Date} [opts.date]
 * @returns {string}
 */
export function renderAdrMarkdown(adr, opts = {}) {
  const date = (opts.date || new Date()).toISOString().slice(0, 10);   // YYYY-MM-DD
  const lines = [
    `# ${String(adr.number).padStart(4, "0")}. ${adr.title}`,
    "",
    `**Status:** ${adr.status}  `,
    `**Date:** ${date}  `,
    "",
    "## Context",
    "",
    adr.context || "_(architect role did not provide an explicit context — see Decision below.)_",
    "",
    "## Decision",
    "",
    adr.decision,
    "",
  ];
  if (adr.alternatives?.length > 0) {
    lines.push("**Alternatives considered:**");
    lines.push("");
    for (const alt of adr.alternatives) lines.push(`- ${alt}`);
    lines.push("");
  }
  lines.push(
    "## Consequences",
    "",
    adr.consequences || "_(no consequences captured by the architect role.)_",
    ""
  );
  return lines.join("\n");
}

/**
 * Write the ADRs to disk under the plan's adrs/ directory. Returns
 * the list of absolute paths written so callers can surface them in
 * the CLI output.
 *
 * @param {object} args
 * @param {string} args.projectDir
 * @param {string} args.planId        - used to scope ADRs to a plan; falls
 *                                      back to "_loose" when this came
 *                                      from `kj architect` standalone
 * @param {Array} args.adrs           - output of extractAdrsFromArchitecture
 * @returns {Promise<string[]>} absolute paths written
 */
export async function writeAdrsToDisk({ projectDir, planId, adrs }) {
  if (!Array.isArray(adrs) || adrs.length === 0) return [];
  if (!projectDir) throw new Error("writeAdrsToDisk: projectDir is required");
  const planSlug = planId || "_loose";
  const dir = join(plansDir(projectDir), planSlug, "adrs");
  await mkdir(dir, { recursive: true });
  const paths = [];
  for (const adr of adrs) {
    const filePath = join(dir, `${adr.id}.md`);
    await writeFile(filePath, renderAdrMarkdown(adr), "utf-8");
    paths.push(filePath);
  }
  return paths;
}

/**
 * Convenience: extract + write in one call. Used by `kj architect`
 * and (later) the orchestrator's architect stage.
 */
export async function persistAdrsFromArchitecture({ projectDir, planId, architecture }) {
  const adrs = extractAdrsFromArchitecture(architecture);
  const paths = await writeAdrsToDisk({ projectDir, planId, adrs });
  return { adrs, paths };
}
