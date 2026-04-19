/**
 * FileSystemService — thin DI-friendly adapter over node:fs/promises.
 *
 * Why: existing code uses node:fs directly (see src/utils/fs.js and consumers),
 * which makes unit-testing orchestrator/agent paths slow and flaky — every test
 * that exercises a code path touching fs has to stage real files on disk.
 *
 * This adapter preserves the exact native API shapes for the handful of
 * operations actually used in the codebase, so consumers can opt-in to DI
 * without rewriting call sites. A matching MockFileSystem lives in
 * src/infrastructure/mocks.js.
 *
 * Scope for TSK-0316: intentionally minimal. Only the operations already used
 * by orchestrator + agents. Additional methods added on demand.
 *
 * @typedef {Object} FileSystemService
 * @property {(path: string, encoding?: string) => Promise<string|Buffer>} readFile
 * @property {(path: string, data: string|Buffer, encoding?: string) => Promise<void>} writeFile
 * @property {(path: string, data: string|Buffer, encoding?: string) => Promise<void>} appendFile
 * @property {(path: string) => Promise<boolean>} exists
 * @property {(path: string) => Promise<void>} ensureDir
 * @property {(path: string) => Promise<string[]>} readdir
 * @property {(src: string, dest: string) => Promise<void>} copyFile
 * @property {(path: string) => Promise<{size: number, isDirectory: () => boolean, isFile: () => boolean}>} stat
 */

import fs from "node:fs/promises";

/**
 * Default implementation backed by node:fs/promises.
 * @type {FileSystemService}
 */
export const defaultFileSystem = {
  async readFile(path, encoding = "utf8") {
    return fs.readFile(path, encoding);
  },
  async writeFile(path, data, encoding = "utf8") {
    await fs.writeFile(path, data, encoding);
  },
  async appendFile(path, data, encoding = "utf8") {
    await fs.appendFile(path, data, encoding);
  },
  async exists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  },
  async ensureDir(path) {
    await fs.mkdir(path, { recursive: true });
  },
  async readdir(path) {
    return fs.readdir(path);
  },
  async copyFile(src, dest) {
    await fs.copyFile(src, dest);
  },
  async stat(path) {
    return fs.stat(path);
  }
};
