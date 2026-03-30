import fs from "node:fs/promises";
import path from "node:path";
import { getKarajanHome } from "../utils/paths.js";

const ROLE_EVENTS = {
  START: "role:start",
  END: "role:end",
  ERROR: "role:error"
};

function resolveRoleMdPath(roleName, projectDir) {
  const fileName = `${roleName}.md`;
  const candidates = [];

  if (projectDir) {
    candidates.push(path.join(projectDir, ".karajan", "roles", fileName));
  }

  candidates.push(path.join(getKarajanHome(), "roles", fileName));

  const builtIn = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "templates",
    "roles",
    fileName
  );
  candidates.push(builtIn);

  return candidates;
}

async function loadFirstExisting(paths) {
  for (const p of paths) {
    try {
      return await fs.readFile(p, "utf8");
    } catch { /* file not found */
      continue;
    }
  }
  return null;
}

export class BaseRole {
  constructor({ name, config, logger, emitter = null }) {
    if (!name) throw new Error("Role name is required");
    this.name = name;
    this.config = config || {};
    this.logger = logger;
    this.emitter = emitter;
    this.instructions = null;
    this._initialized = false;
    this._startTime = null;
    this._output = null;
  }

  async init(context = {}) {
    this.context = context;
    const projectDir = this.config.projectDir || process.cwd();
    const paths = resolveRoleMdPath(this.name, projectDir);
    this.instructions = await loadFirstExisting(paths);
    this._initialized = true;
  }

  async execute(_input) {
    throw new Error(`${this.name}: execute() not implemented`);
  }

  report() {
    return {
      role: this.name,
      ok: this._output?.ok ?? false,
      result: this._output?.result ?? null,
      summary: this._output?.summary ?? "",
      timestamp: new Date().toISOString()
    };
  }

  validate(output) {
    if (!output) return { valid: false, reason: "Output is null or undefined" };
    if (typeof output.ok !== "boolean") return { valid: false, reason: "Output.ok must be a boolean" };
    return { valid: true, reason: "" };
  }

  async run(input) {
    this._ensureInitialized();
    this._startTime = Date.now();
    this._emitEvent(ROLE_EVENTS.START, { input });

    try {
      const output = await this.execute(input);
      this._output = output;

      const validation = this.validate(output);
      if (!validation.valid) {
        throw new Error(`${this.name} output validation failed: ${validation.reason}`);
      }

      this._emitEvent(ROLE_EVENTS.END, { output: this.report() });
      return output;
    } catch (error) {
      this._emitEvent(ROLE_EVENTS.ERROR, { error: error.message });
      throw error;
    }
  }

  _ensureInitialized() {
    if (!this._initialized) {
      throw new Error(`${this.name}: init() must be called before run()`);
    }
  }

  _emitEvent(type, detail = {}) {
    if (!this.emitter) return;
    this.emitter.emit(type, {
      role: this.name,
      iteration: this.context?.iteration ?? 0,
      sessionId: this.context?.sessionId ?? null,
      elapsed: this._startTime ? Date.now() - this._startTime : 0,
      timestamp: new Date().toISOString(),
      ...detail
    });
  }
}

export { ROLE_EVENTS, resolveRoleMdPath, loadFirstExisting };
