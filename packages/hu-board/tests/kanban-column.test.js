// KJC-BUG-0405: an HU in `running` (what kj hu move and the shared-board mirror write) was
// in no kanban column. Every view now places a status through one function.
//
// formatters.js is a classic browser script (no exports), so the test loads it into a
// node:vm context and asserts against the hoisted function declaration.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(
  fileURLToPath(new URL('../public/utils/formatters.js', import.meta.url)),
  'utf8'
);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);

describe('kanbanColumnOf (KJC-BUG-0405)', () => {
  it('puts running next to coding and reviewing', () => {
    for (const s of ['running', 'coding', 'reviewing']) expect(ctx.kanbanColumnOf(s)).toBe('running');
  });

  it('keeps the other lanes as they were', () => {
    for (const s of ['pending', 'certified', 'needs_context', 'blocked', 'failed']) expect(ctx.kanbanColumnOf(s)).toBe('pending');
    expect(ctx.kanbanColumnOf('done')).toBe('done');
  });

  // KJC-TSK-1351: "a run of this board" (isBoardRun) went with kj run; a running HU is only in progress.
  it('has no notion of a board run any more', () => {
    expect(vm.runInContext("typeof isBoardRun + ',' + typeof isBoardRunnable", ctx)).toBe('undefined,undefined');
  });
});
