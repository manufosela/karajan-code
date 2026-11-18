/**
 * HU-4595 (ADR 0064 decision 7): does the interactive session run on one of the project's accounts?
 * kj reads only the login variable of the session, never a key or a provider file.
 */
import fs from "node:fs";
import path from "node:path";
import { ACCOUNT_VAR } from "../utils/agent-home.js";
import { readAccounts } from "./store.js";

const real = (dir) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

function projectAccounts(data, provider, projectKey) {
  const ids = data.projects[projectKey]?.[provider] ?? (data.default[provider] ? [data.default[provider]] : []);
  return ids.map((id) => data.accounts.find((a) => a.id === id)).filter(Boolean);
}

/** @returns {string[]} one line per provider whose session login is not one of the project's accounts */
export function sessionWarnings({ env = process.env, projectKey, home } = {}) {
  const data = readAccounts({ home });
  const lines = [];
  for (const [provider, variable] of Object.entries(ACCOUNT_VAR)) {
    const dir = env[variable];
    if (!dir) continue;
    const accounts = projectAccounts(data, provider, projectKey);
    if (accounts.length === 0 || accounts.some((a) => real(a.dir) === real(dir))) continue;
    lines.push(`${provider} session runs on ${dir}; this project uses account "${accounts[0].id}" (${accounts[0].dir})`);
  }
  return lines;
}

/** Providers whose login this session reveals (the variable is set). */
export const tellableProviders = (env = process.env) => Object.entries(ACCOUNT_VAR).filter(([, v]) => env[v]).map(([p]) => p);
