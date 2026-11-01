import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { projectPlans, findPlanFile } from '../src/plans-service.js';

// KJC-TSK-0541: the plan scans the API routes share, testable without Express.
describe('plans-service', () => {
  let root;
  let saved;

  beforeEach(async () => {
    saved = process.env.KJ_PLANS_DIR;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'kj-plans-service-'));
    process.env.KJ_PLANS_DIR = root;
    await fs.mkdir(path.join(root, 'proj'), { recursive: true });
    await fs.writeFile(path.join(root, 'proj', 'plan-a.json'), JSON.stringify({ planId: 'a', version: 2 }));
    await fs.writeFile(path.join(root, 'proj', 'plan-b.json'), '{ not json');
    await fs.writeFile(path.join(root, 'proj', 'notes.txt'), 'ignored');
  });

  afterEach(async () => {
    if (saved === undefined) delete process.env.KJ_PLANS_DIR;
    else process.env.KJ_PLANS_DIR = saved;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('yields the readable plan JSONs of a project and skips unreadable ones', async () => {
    const plans = [];
    for await (const plan of projectPlans('proj')) plans.push(plan.planId);
    expect(plans).toEqual(['a']);
  });

  it('yields nothing for a project without a plans directory', async () => {
    const plans = [];
    for await (const plan of projectPlans('missing')) plans.push(plan);
    expect(plans).toEqual([]);
  });

  it('finds a plan file by id across projects, or null', async () => {
    expect(await findPlanFile('a')).toBe(path.join(root, 'proj', 'plan-a.json'));
    expect(await findPlanFile('zzz')).toBeNull();
  });
});
