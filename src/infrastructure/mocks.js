/**
 * Test doubles for the DI surfaces. Intentionally dumb — tests stage inputs
 * through simple setters and assert on recorded calls.
 *
 * @typedef {import("./file-system-service.js").FileSystemService} FileSystemService
 * @typedef {import("./command-runner.js").CommandRunner} CommandRunner
 * @typedef {import("./command-runner.js").CommandRunResult} CommandRunResult
 * @typedef {import("./command-runner.js").CommandRunOptions} CommandRunOptions
 */

/**
 * In-memory file system. Paths are stored as-is (no normalization) to keep
 * behaviour predictable in tests.
 */
export class MockFileSystem {
  constructor(initial = {}) {
    /** @type {Map<string, string|Buffer>} */
    this.files = new Map(Object.entries(initial));
    /** @type {Set<string>} */
    this.directories = new Set();
    /** @type {Array<{op: string, path: string, args?: unknown}>} */
    this.calls = [];
  }

  _record(op, path, args) {
    this.calls.push({ op, path, args });
  }

  async readFile(path, encoding = "utf8") {
    this._record("readFile", path, { encoding });
    if (!this.files.has(path)) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
      err.code = "ENOENT";
      throw err;
    }
    const data = this.files.get(path);
    if (Buffer.isBuffer(data) && encoding) return data.toString(encoding);
    return data;
  }

  async writeFile(path, data, encoding = "utf8") {
    this._record("writeFile", path, { encoding });
    this.files.set(path, data);
  }

  async appendFile(path, data, encoding = "utf8") {
    this._record("appendFile", path, { encoding });
    const prev = this.files.get(path) ?? "";
    this.files.set(path, String(prev) + String(data));
  }

  async exists(path) {
    this._record("exists", path);
    return this.files.has(path) || this.directories.has(path);
  }

  async ensureDir(path) {
    this._record("ensureDir", path);
    this.directories.add(path);
  }

  async readdir(path) {
    this._record("readdir", path);
    const prefix = path.endsWith("/") ? path : path + "/";
    const entries = new Set();
    for (const p of this.files.keys()) {
      if (p.startsWith(prefix)) {
        const tail = p.slice(prefix.length).split("/")[0];
        if (tail) entries.add(tail);
      }
    }
    if (!entries.size && !this.directories.has(path)) {
      const err = new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      err.code = "ENOENT";
      throw err;
    }
    return [...entries];
  }

  async copyFile(src, dest) {
    this._record("copyFile", src, { dest });
    if (!this.files.has(src)) {
      const err = new Error(`ENOENT: no such file or directory, copyfile '${src}' -> '${dest}'`);
      err.code = "ENOENT";
      throw err;
    }
    this.files.set(dest, this.files.get(src));
  }

  async stat(path) {
    this._record("stat", path);
    if (this.files.has(path)) {
      const data = this.files.get(path);
      const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data));
      return {
        size,
        isDirectory: () => false,
        isFile: () => true
      };
    }
    if (this.directories.has(path)) {
      return {
        size: 0,
        isDirectory: () => true,
        isFile: () => false
      };
    }
    const err = new Error(`ENOENT: no such file or directory, stat '${path}'`);
    err.code = "ENOENT";
    throw err;
  }
}

/**
 * Scripted command runner. Tests call enqueue() to stage responses in order,
 * or setResponder() for a per-invocation decision. Every run() is recorded.
 */
export class MockCommandRunner {
  constructor() {
    /** @type {Array<CommandRunResult>} */
    this.queue = [];
    /** @type {Array<{command: string, args: string[], options: CommandRunOptions}>} */
    this.calls = [];
    /** @type {null | ((args: {command: string, args: string[], options: CommandRunOptions}) => CommandRunResult|Promise<CommandRunResult>)} */
    this.responder = null;
    /** @type {CommandRunResult} */
    this.defaultResponse = { exitCode: 0, stdout: "", stderr: "" };
  }

  /**
   * Queue a response. FIFO — first enqueued is returned on the first run().
   * @param {Partial<CommandRunResult>} response
   */
  enqueue(response) {
    this.queue.push({ exitCode: 0, stdout: "", stderr: "", ...response });
    return this;
  }

  /**
   * Replace FIFO queue with a function that decides per-call.
   * @param {(args: {command: string, args: string[], options: CommandRunOptions}) => CommandRunResult|Promise<CommandRunResult>} fn
   */
  setResponder(fn) {
    this.responder = fn;
    return this;
  }

  /**
   * @param {string} command
   * @param {string[]} args
   * @param {CommandRunOptions} options
   * @returns {Promise<CommandRunResult>}
   */
  async run(command, args = [], options = {}) {
    this.calls.push({ command, args: [...args], options: { ...options } });
    if (this.responder) return this.responder({ command, args, options });
    if (this.queue.length > 0) return this.queue.shift();
    return { ...this.defaultResponse };
  }

  /**
   * Convenience: last recorded invocation, or null.
   */
  get lastCall() {
    return this.calls.at(-1) ?? null;
  }
}

/**
 * Build an Environment backed by the mocks above. Useful shorthand in tests:
 *
 *   const { env, fs, runner } = buildMockEnvironment();
 *   const agent = new BaseAgent(..., env);
 *
 * @param {{files?: Record<string, string|Buffer>}} [opts]
 */
export function buildMockEnvironment({ files } = {}) {
  const fs = new MockFileSystem(files);
  const runner = new MockCommandRunner();
  const env = Object.freeze({ fs, runner });
  return { env, fs, runner };
}
