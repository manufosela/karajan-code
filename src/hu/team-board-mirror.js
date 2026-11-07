/**
 * KJC-TSK-1166 (TEAM-GH-E, ADR 0025): what `kj board` shows of the shared board. The web
 * board reads plans, so the shared board is mirrored into one read-only plan per project,
 * rewritten from the issues every time kj reads them. It is a view: changing it is done
 * with kj hu move, never from the web, and the board refuses to edit it.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { plansDir, savePlan } from "../plan/plan-store.js";
import { boardKey } from "./board-key.js";

// KJC-BUG-0397: the board reads plan-*.json only and groups a plan by its projectDir;
// the mirror was plan_github-board.json with no projectDir, so it was never shown.
// HU-3386: one mirror per board (plan-<backend>[-<team>]-board), named by board-key.js.
export const MIRROR_PLAN_ID = "plan-github-board";
export const isMirrorFile = (file) => /^plan-(?:github|linear)(?:-[\w-]+)?-board\.json$/.test(file);
const LEGACY_MIRROR_FILE = "plan_github-board.json";

/** The shared board as a plan the web board can show, marked read-only. */
export async function writeTeamMirror(projectDir, rows, { repo, key = boardKey({ backend: "github", repo }) }) {
  const now = new Date().toISOString();
  const plan = {
    version: 2, planId: key.planId, name: key.name, alias: key.name, projectDir,
    task: `Shared HU Board: ${key.label}`,
    status: "ready", readonly: key.name, repo: key.place, createdAt: now,
    hus: rows.map((r) => ({
      id: r.short_id, short_id: r.short_id, title: r.title, status: r.status,
      // KJC-BUG-0443: the tracker card it replicates too, so the gates find it by that reference.
      claimed_by: r.claimed_by ?? null, created_by: key.name, external_ref: [key.refOf(r), r.ref].filter(Boolean).join(" · "),
      acceptance_criteria: [], acceptance_tests: [], createdAt: now, updatedAt: now,
      // HU-3533: the tier the manager keeps, as the complexity the coder routing reads.
      ...(r.tier ? { complexity: { tier: r.tier.level, reason: r.tier.reason ?? null } } : {}),
    })),
  };
  await savePlan(projectDir, plan);
  await rm(path.join(plansDir(projectDir), LEGACY_MIRROR_FILE), { force: true });
  return plan;
}
