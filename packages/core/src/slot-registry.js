/**
 * PAR-H (KJC-TSK-0631): stable numeric slots for parallel worktree lanes.
 *
 * Each lane gets the lowest free slot, persisted outside the repo so the
 * same lane id keeps its slot across runs. The slot drives a port offset
 * (`base + slot × increment`) so concurrent lanes can publish services
 * without colliding. Design after Jorge del Casar's worktree-docker-envs
 * skill: the registry is pure logic over a JSON file, guarded by a
 * mkdir-based lock so concurrent lane starts serialize safely.
 */
import { mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_MS = 30_000;

async function withFileLock(registryPath, fn) {
  const lockDir = `${registryPath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lockDir, { recursive: false });
      break;
    } catch {
      // A crashed holder leaves the lock behind — steal it when old enough.
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > STALE_LOCK_MS) {
          rmdirSync(lockDir);
          continue;
        }
      } catch { /* raced with the holder's release — just retry */ }
      if (Date.now() > deadline) throw new Error(`slot-registry: lock timeout on ${lockDir}`);
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  try {
    return fn();
  } finally {
    try { rmdirSync(lockDir); } catch { /* already gone */ }
  }
}

function loadRegistry(registryPath) {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf-8"));
    return { slots: parsed?.slots && typeof parsed.slots === "object" ? parsed.slots : {} };
  } catch {
    return { slots: {} };
  }
}

function saveRegistry(registryPath, reg) {
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(reg, null, 2));
}

/** Port offset for a slot. The project applies its own base on top. */
export function computePortOffset(slot, increment = 100) {
  return slot * increment;
}

/**
 * Assign (or re-find) the slot for a lane id. Lowest free slot wins;
 * the same id always gets its previous slot back while it holds one.
 *
 * @param {object} params
 * @param {string} params.registryPath  JSON file, e.g. ~/.karajan/worktree-slots.json
 * @param {string} params.id            Stable lane identifier (projectDir + huId)
 * @returns {Promise<{slot: number, reused: boolean}>}
 */
export async function acquireSlot({ registryPath, id }) {
  return withFileLock(registryPath, () => {
    const reg = loadRegistry(registryPath);
    if (Number.isInteger(reg.slots[id])) return { slot: reg.slots[id], reused: true };
    const used = new Set(Object.values(reg.slots));
    let slot = 0;
    while (used.has(slot)) slot += 1;
    reg.slots[id] = slot;
    saveRegistry(registryPath, reg);
    return { slot, reused: false };
  });
}

/**
 * Free a lane's slot so the next lane can reuse the number.
 * @returns {Promise<boolean>} true when the id held a slot.
 */
export async function releaseSlot({ registryPath, id }) {
  return withFileLock(registryPath, () => {
    const reg = loadRegistry(registryPath);
    if (id in reg.slots) {
      delete reg.slots[id];
      saveRegistry(registryPath, reg);
      return true;
    }
    return false;
  });
}
