/**
 * KJC-TSK-1166 (TEAM-GH-E, ADR 0025): what `kj board` shows of the shared board. The web
 * board reads plans, so the shared board is mirrored into one read-only plan per project,
 * rewritten from the issues every time kj reads them. It is a view: changing it is done
 * with kj hu move, never from the web, and the board refuses to edit it.
 */
import { savePlan } from "../plan/plan-store.js";

export const MIRROR_PLAN_ID = "plan_github-board";

/** The shared board as a plan the web board can show, marked read-only. */
export async function writeTeamMirror(projectDir, rows, { repo }) {
  const now = new Date().toISOString();
  const plan = {
    version: 2, planId: MIRROR_PLAN_ID, name: "github", alias: "github",
    task: `Shared HU Board: GitHub Issues of ${repo}`,
    status: "ready", readonly: "github", createdAt: now,
    hus: rows.map((r) => ({
      id: r.short_id, short_id: r.short_id, title: r.title, status: r.status,
      claimed_by: r.claimed_by ?? null, created_by: "github", external_ref: `${repo}#${r.number}`,
      acceptance_criteria: [], acceptance_tests: [], createdAt: now, updatedAt: now,
    })),
  };
  await savePlan(projectDir, plan);
  return plan;
}
