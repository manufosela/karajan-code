/**
 * HU-4029: the pipeline of a lane's open pull request (running, failed or passed), from the
 * checks `gh pr view` reports for the lane's branch. Anything unreadable is null: no guess.
 * gh is a network call: it runs without blocking the server, a few lanes at a time.
 */
import { runCommand } from 'karajan-core/process';

import { MAIN_LANE, listLanes } from './lanes.js';

const BAD = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);
const GOOD = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/** One check as 'failed', 'running' or 'passed': a check run by its conclusion, a status by its state. */
function checkState(c) {
  const done = c.__typename === 'StatusContext' ? c.state : (c.status === 'COMPLETED' ? c.conclusion : null);
  if (done === null || done === 'PENDING' || done === 'EXPECTED') return 'running';
  if (BAD.has(done)) return 'failed';
  return GOOD.has(done) ? 'passed' : 'running';
}

/** @returns {'failed'|'running'|'passed'|null} failed beats running beats passed; no checks, null. */
export function pipelineOf(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return null;
  const states = rollup.map(checkState);
  if (states.includes('failed')) return 'failed';
  return states.includes('running') ? 'running' : 'passed';
}

/** What gh says of the pull request of the branch at `dir`; a gh that fails or times out throws. */
async function ghView(dir) {
  const r = await runCommand('gh', ['pr', 'view', '--json', 'state,statusCheckRollup'], { cwd: dir, timeout: 5000 });
  if (r.exitCode !== 0) throw new Error(`gh pr view: exit ${r.exitCode}`);
  return r.stdout;
}

const TTL_MS = 30 * 1000;
const GH_AT_ONCE = 4;
const cache = new Map();

/** The pipeline of the open pull request of the branch checked out at `dir`, or null; never rejects. */
export async function pipelineFacts(dir, { run = ghView } = {}) {
  try {
    const pr = JSON.parse(await run(dir));
    return pr.state === 'OPEN' ? pipelineOf(pr.statusCheckRollup) : null;
  } catch {
    return null;
  }
}

/** `pipelineFacts` kept for 30 seconds per lane, a read in flight shared: the stage polls. */
export function cachedPipeline(dir, { now = Date.now(), read = pipelineFacts } = {}) {
  const hit = cache.get(dir);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = read(dir);
  cache.set(dir, { at: now, value });
  return value;
}

/** The pipeline of each lane of the project but the main checkout, by its dir, `limit` at a time. */
export async function lanePipelines(projectDir, { limit = GH_AT_ONCE, read = cachedPipeline } = {}) {
  const queue = listLanes(projectDir).filter(({ lane }) => lane !== MAIN_LANE).map(({ dir }) => dir);
  const pipelines = new Map();
  const worker = async () => {
    for (let dir = queue.shift(); dir; dir = queue.shift()) pipelines.set(dir, await read(dir));
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return pipelines;
}
