/**
 * async-lock — named in-process mutex (KJC-TSK-0625, épica KJC-PCS-0065).
 * Parallel HU lanes run inside ONE kj process; shared single-instance
 * resources (the SonarQube server scans one project key at a time) must
 * serialize across lanes. `withLock` chains callers per name in FIFO
 * order; sequential runs pay nothing (the chain is always settled).
 */

const locks = new Map(); // name -> { tail: Promise, holders: number }

/** Run `fn` exclusively among every caller sharing `name`. */
export async function withLock(name, fn) {
  const entry = locks.get(name) ?? { tail: Promise.resolve(), holders: 0 };
  entry.holders += 1;
  locks.set(name, entry);

  const previous = entry.tail;
  let release;
  entry.tail = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release();
    entry.holders -= 1;
    if (entry.holders === 0) locks.delete(name);
  }
}
