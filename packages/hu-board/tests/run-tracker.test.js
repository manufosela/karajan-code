// KJC-TSK-0396: tests del run-tracker en memoria.
import { describe, it, expect, beforeEach } from 'vitest';
import { trackRun, getActiveRuns, getAllActiveRuns, untrack, _resetForTests } from '../src/run-tracker.js';

beforeEach(() => { _resetForTests(); });

describe('run-tracker', () => {
  it('trackRun registra un PID para un planId', () => {
    trackRun('plan-A', { pid: process.pid });
    const active = getActiveRuns('plan-A');
    expect(active).toHaveLength(1);
    expect(active[0].pid).toBe(process.pid);
  });

  it('getActiveRuns filtra PIDs muertos (process.kill ESRCH)', () => {
    // PID 99999999 prácticamente seguro que NO existe en el sistema.
    trackRun('plan-A', { pid: 99999999 });
    const active = getActiveRuns('plan-A');
    expect(active).toEqual([]);
  });

  it('untrack elimina un PID concreto', () => {
    trackRun('plan-A', { pid: process.pid });
    trackRun('plan-A', { pid: process.ppid });
    untrack('plan-A', process.pid);
    const active = getActiveRuns('plan-A');
    expect(active.map((r) => r.pid)).toEqual([process.ppid]);
  });

  it('getAllActiveRuns devuelve un map planId → runs vivos', () => {
    trackRun('plan-A', { pid: process.pid });
    trackRun('plan-B', { pid: process.pid });
    trackRun('plan-C', { pid: 99999999 }); // muerto
    const all = getAllActiveRuns();
    expect(Object.keys(all).sort()).toEqual(['plan-A', 'plan-B']);
    expect(all['plan-A']).toHaveLength(1);
    expect(all['plan-B']).toHaveLength(1);
    expect(all['plan-C']).toBeUndefined();
  });

  it('huIds se conserva en la entrada', () => {
    trackRun('plan-A', { pid: process.pid, huIds: ['hu_1', 'hu_2'] });
    const active = getActiveRuns('plan-A');
    expect(active[0].huIds).toEqual(['hu_1', 'hu_2']);
  });

  it('múltiples PIDs por planId funcionan (múltiples runs simultáneos)', () => {
    trackRun('plan-A', { pid: process.pid });
    trackRun('plan-A', { pid: process.ppid });
    const active = getActiveRuns('plan-A');
    expect(active.map((r) => r.pid).sort()).toEqual([process.pid, process.ppid].sort());
  });

  it('llamadas degeneradas no rompen (planId vacío, pid 0)', () => {
    trackRun('', { pid: 123 });
    trackRun('plan-A', { pid: 0 });
    trackRun('plan-A', null);
    expect(getActiveRuns('plan-A')).toEqual([]);
  });
});
