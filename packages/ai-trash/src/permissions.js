import { promises as fs } from "node:fs";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export async function ensureSecureDir(path) {
  await fs.mkdir(path, { recursive: true, mode: DIR_MODE });
  await fs.chmod(path, DIR_MODE);
}

export async function lockdownFile(path) {
  await fs.chmod(path, FILE_MODE);
}

export async function assertOwnedByCurrentUser(path) {
  if (process.platform === "win32") return;
  const stats = await fs.stat(path);
  if (typeof process.getuid !== "function") return;
  if (stats.uid !== process.getuid()) {
    throw new Error(
      `ai-trash: ${path} is owned by uid ${stats.uid}, expected ${process.getuid()}`
    );
  }
}

export { DIR_MODE, FILE_MODE };
