/**
 * db — better-sqlite3-compatible adapter over node:sqlite (KJC-TSK-0615).
 * node:sqlite ships INSIDE Node 22+ — no native addon, no node-gyp, and it
 * works inside the SEA standalone binary. Exposes the exact surface karajan
 * consumes so vec-store / hu-board / audit-history migrate without rewrites.
 */

import { createRequire } from "node:module";

// node:sqlite emits a one-time ExperimentalWarning on load that would leak
// into every kj command's output. Swallow ONLY that warning, only during
// the import — anything else still reaches the user.
const require = createRequire(import.meta.url);
const { DatabaseSync } = (() => {
  const original = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const text = String(warning?.message ?? warning);
    if (text.includes("SQLite is an experimental feature")) return;
    return original.call(process, warning, ...rest);
  };
  try {
    return require("node:sqlite");
  } finally {
    process.emitWarning = original;
  }
})();

class DbHandle {
  #db;

  constructor(db) {
    this.#db = db;
  }

  /** Prepared statement with better-sqlite3's run/get/all surface. */
  prepare(sql) {
    const stmt = this.#db.prepare(sql);
    return {
      run: (...args) => stmt.run(...args),
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args),
    };
  }

  exec(sql) {
    this.#db.exec(sql);
    return this;
  }

  /**
   * better-sqlite3-style pragma: `pragma("user_version", { simple: true })`
   * returns the scalar; `pragma("journal_mode = WAL")` applies the setting.
   */
  pragma(text, { simple = false } = {}) {
    let rows;
    try {
      rows = this.#db.prepare(`PRAGMA ${text}`).all();
    } catch {
      // Some pragma writes are not preparable — run them directly.
      this.#db.exec(`PRAGMA ${text}`);
      rows = [];
    }
    if (simple) {
      const first = rows[0];
      return first ? Object.values(first)[0] : undefined;
    }
    return rows;
  }

  /**
   * better-sqlite3-style transaction: returns a function that wraps `fn`
   * in BEGIN/COMMIT, rolling back if it throws.
   */
  transaction(fn) {
    return (...args) => {
      this.#db.exec("BEGIN");
      try {
        const result = fn(...args);
        this.#db.exec("COMMIT");
        return result;
      } catch (err) {
        this.#db.exec("ROLLBACK");
        throw err;
      }
    };
  }

  loadExtension(path) {
    this.#db.loadExtension(path);
  }

  close() {
    this.#db.close();
  }
}

/**
 * Open (or create) a SQLite database at `location` (a path or ":memory:").
 * `allowExtension: true` is required to later loadExtension (sqlite-vec).
 */
export function openDatabase(location, { allowExtension = false } = {}) {
  return new DbHandle(new DatabaseSync(location, allowExtension ? { allowExtension: true } : {}));
}
