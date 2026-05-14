// KJC-TSK-0394 step 3: tests del HU zombie reaper.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { classifyHuZombie, findZombieHus, reapZombieHus } from '../src/hu-zombie-reaper.js';

const NOW = new Date('2026-05-13T12:00:00Z').getTime();
const ago = (min) => new Date(NOW - min * 60_000).toISOString();

describe('classifyHuZombie', () => {
  const ctx = { now: NOW, runningMinutes: 30 };

  it('coding/reviewing/running >threshold son zombi', () => {
    for (const status of ['coding', 'reviewing', 'running']) {
      const v = classifyHuZombie({ id: 'a', status, updated_at: ago(45) }, ctx);
      expect(v.zombie).toBe(true);
      expect(v.reason).toMatch(new RegExp(status));
    }
  });

  it('coding activo (<threshold) NO es zombi', () => {
    expect(classifyHuZombie({ id: 'a', status: 'coding', updated_at: ago(10) }, ctx).zombie).toBe(false);
  });

  it('estados no-running (pending/done/failed) nunca son zombi', () => {
    for (const status of ['pending', 'done', 'failed', 'certified', 'blocked']) {
      expect(classifyHuZombie({ id: 'a', status, updated_at: ago(60 * 24) }, ctx).zombie).toBe(false);
    }
  });

  it('updated_at ausente o inválido no es zombi', () => {
    expect(classifyHuZombie({ id: 'a', status: 'coding' }, ctx).zombie).toBe(false);
    expect(classifyHuZombie({ id: 'a', status: 'coding', updated_at: 'kk' }, ctx).zombie).toBe(false);
  });
});

describe('findZombieHus', () => {
  it('filtra solo zombis y respeta el threshold', () => {
    const hus = [
      { id: 'a', status: 'coding', updated_at: ago(90) },
      { id: 'b', status: 'reviewing', updated_at: ago(90) },
      { id: 'c', status: 'coding', updated_at: ago(5) },
      { id: 'd', status: 'done', updated_at: ago(90) },
    ];
    expect(findZombieHus(hus, { now: NOW, runningMinutes: 30 }).map((z) => z.hu.id)).toEqual(['a', 'b']);
  });
});

describe('reapZombieHus', () => {
  let db;
  const insert = (id, planId, status, result, updated) =>
    db.prepare("INSERT INTO stories VALUES (?, ?, ?, ?, ?, ?)").run(id, 'proj', planId, status, result, updated);

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE stories (id TEXT PRIMARY KEY, project_id TEXT, plan_id TEXT, status TEXT, result TEXT, updated_at TEXT);`);
  });
  afterEach(() => { db.close(); });

  it('resetea zombis a pending vía setHuStatus y preserva result', () => {
    insert('proj::hu_001', 'plan-x', 'coding', 'fail', ago(60));
    insert('proj::hu_002', 'plan-x', 'reviewing', null, ago(60));
    insert('proj::hu_003', 'plan-x', 'coding', null, ago(5)); // activa, no se toca
    const setHuStatus = vi.fn(() => ({ ok: true, status: 'pending', planStatus: 'draft' }));
    const reaped = reapZombieHus({ db, setHuStatus, opts: { runningMinutes: 30 }, now: () => NOW });
    expect(reaped).toHaveLength(2);
    expect(reaped.map((r) => r.id).sort()).toEqual(['proj::hu_001', 'proj::hu_002']);
    expect(reaped.every((r) => r.plan_persisted)).toBe(true);
    expect(setHuStatus).toHaveBeenCalledWith({ planId: 'plan-x', huId: 'hu_001', status: 'pending', projectId: 'proj' });
  });

  it('fallback DB-only cuando setHuStatus falla', () => {
    insert('proj::hu_001', 'plan-x', 'coding', null, ago(60));
    const setHuStatus = vi.fn(() => ({ ok: false, error: 'plan not found' }));
    const reaped = reapZombieHus({ db, setHuStatus, opts: { runningMinutes: 30 }, now: () => NOW });
    expect(reaped[0].plan_persisted).toBe(false);
    expect(db.prepare("SELECT status FROM stories WHERE id = 'proj::hu_001'").get().status).toBe('pending');
  });

  it('retorna [] sin zombis o sin db', () => {
    insert('proj::hu_001', 'plan-x', 'done', 'pass', ago(60));
    expect(reapZombieHus({ db, setHuStatus: vi.fn(), now: () => NOW })).toEqual([]);
    expect(reapZombieHus({ db: null, setHuStatus: vi.fn() })).toEqual([]);
  });

  // KJC-TSK-0404: además de resetear status=pending, el reaper marca
  // la HU con result=fail + blocker para que el siguiente `kj run`
  // tenga contexto del fallo previo.
  it('al detectar zombi llama setHuFailResult con el motivo del timeout', () => {
    insert('proj::hu_001', 'plan-x', 'coding', null, ago(60));
    const setHuStatus = vi.fn(() => ({ ok: true, status: 'pending', planStatus: 'draft' }));
    const setHuFailResult = vi.fn(() => ({ ok: true }));
    reapZombieHus({ db, setHuStatus, setHuFailResult, opts: { runningMinutes: 30 }, now: () => NOW });
    expect(setHuFailResult).toHaveBeenCalledTimes(1);
    const call = setHuFailResult.mock.calls[0][0];
    expect(call.planId).toBe('plan-x');
    expect(call.huId).toBe('hu_001');
    expect(call.blocker).toMatch(/timeout/i);
  });

  it('no llama setHuFailResult si setHuStatus falla (DB-only fallback)', () => {
    insert('proj::hu_001', 'plan-x', 'coding', null, ago(60));
    const setHuStatus = vi.fn(() => ({ ok: false, error: 'plan not found' }));
    const setHuFailResult = vi.fn(() => ({ ok: true }));
    reapZombieHus({ db, setHuStatus, setHuFailResult, opts: { runningMinutes: 30 }, now: () => NOW });
    expect(setHuFailResult).not.toHaveBeenCalled();
  });
});
