/**
 * KJC-TSK-1166 (TEAM-GH-E, ADR 0025): what `kj board` shows of the shared board. The web
 * board reads plans, so the shared board is mirrored into one read-only plan per project,
 * rewritten from the issues every time kj reads them. It is a view: changing it is done
 * with kj hu move, never from the web, and the board refuses to edit it.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { plansDir, savePlan } from "../plan/plan-store.js";

// KJC-BUG-0397: the board reads plan-*.json only and groups a plan by its projectDir;
// the mirror was plan_github-board.json with no projectDir, so it was never shown.
export const MIRROR_PLAN_ID = "plan-github-board";
const LEGACY_MIRROR_FILE = "plan_github-board.json";

/** The shared board as a plan the web board can show, marked read-only. */
export async function writeTeamMirror(projectDir, rows, { repo }) {
  const now = new Date().toISOString();
  const plan = {
    version: 2, planId: MIRROR_PLAN_ID, name: "github", alias: "github", projectDir,
    task: `Shared HU Board: GitHub Issues of ${repo}`,
    status: "ready", readonly: "github", repo, createdAt: now,
    hus: rows.map((r) => ({
      id: r.short_id, short_id: r.short_id, title: r.title, status: r.status,
      claimed_by: r.claimed_by ?? null, created_by: "github", external_ref: `${repo}#${r.number}`,
      acceptance_criteria: [], acceptance_tests: [], createdAt: now, updatedAt: now,
    })),
  };
  await savePlan(projectDir, plan);
  await rm(path.join(plansDir(projectDir), LEGACY_MIRROR_FILE), { force: true });
  return plan;
}
