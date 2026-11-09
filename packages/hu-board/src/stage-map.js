/**
 * KJC-TSK-1446 (ADR 0049): the map of kj stage, one factory per project of the
 * user. A project is on the map when the board knows it, it is not a test
 * project and its directory resolves (ADR 0011). Factories with robots at work
 * go first; the rest keep the board's order (latest activity first).
 */
import { basename } from 'node:path';

import { getProjects } from './db.js';
import { projectDirForSlug } from './project-dir.js';
import { watchLanes as watchProjectLanes } from './stage-feed.js';
import { laneStates } from './stage-state.js';

const withDefaults = ({ projects, dirOf, lanesOf }) => ({
  projects: projects ?? getProjects(),
  dirOf: dirOf ?? projectDirForSlug,
  lanesOf: lanesOf ?? laneStates,
});

const factories = ({ projects, dirOf }) => projects
  .filter((p) => !p.is_test)
  .flatMap((p) => {
    const dir = dirOf(p.id);
    return dir ? [{ project: p.id, dir }] : [];
  });

const atWork = (factory) => factory.lanes.reduce((n, lane) => n + (lane.working?.length ?? 0), 0);

/** @returns {Array<{project: string, name: string, lanes: object[]}>} every factory with the state of its lanes. */
export function stageMap(options = {}) {
  const deps = withDefaults(options);
  return factories(deps)
    // KJC-TSK-1482: the factory is called after its folder; the slug spells the whole path.
    .map(({ project, dir }) => ({ project, name: basename(dir), lanes: deps.lanesOf(dir) }))
    .toSorted((a, b) => atWork(b) - atWork(a));
}

/** Watches the lanes of every factory; each event comes tagged with its project and lane. */
export function watchMap(send, { watchLanes = watchProjectLanes, ...options } = {}) {
  const stops = factories(withDefaults(options)).map(({ project, dir }) => watchLanes(dir, send, { project }));
  return () => stops.forEach((stop) => stop());
}
