/**
 * Topological sort of HU stories respecting blocked_by dependencies.
 * Returns ordered array of story IDs (dependencies first).
 * Throws if circular dependency detected.
 * @param {Array<{id: string, blocked_by?: string[]}>} stories
 * @returns {string[]} Sorted story IDs.
 */
export function topologicalSort(stories) {
  const ids = new Set(stories.map(s => s.id));
  const adj = new Map(); // id -> [dependents]
  const inDegree = new Map();

  for (const s of stories) {
    adj.set(s.id, []);
    inDegree.set(s.id, 0);
  }

  for (const s of stories) {
    for (const dep of (s.blocked_by || [])) {
      if (!ids.has(dep)) throw new Error(`Dependency ${dep} not found in batch`);
      adj.get(dep).push(s.id);
      inDegree.set(s.id, (inDegree.get(s.id) || 0) + 1);
    }
  }

  const queue = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);
    for (const dependent of adj.get(id)) {
      inDegree.set(dependent, inDegree.get(dependent) - 1);
      if (inDegree.get(dependent) === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== stories.length) {
    throw new Error("Circular dependency detected in HU batch");
  }

  return sorted;
}

/**
 * Check if a story is ready to execute (all its dependencies are done).
 * @param {{blocked_by?: string[]}} story
 * @param {{stories: Array<{id: string, status: string}>}} batch
 * @returns {boolean}
 */
export function isStoryReady(story, batch) {
  if (!story.blocked_by || story.blocked_by.length === 0) return true;
  return story.blocked_by.every(depId => {
    const dep = batch.stories.find(s => s.id === depId);
    return dep && dep.status === "done";
  });
}

/**
 * Get next stories ready for execution (certified + all deps done).
 * @param {{stories: Array<{id: string, status: string, blocked_by?: string[]}>}} batch
 * @returns {Array<object>} Stories that are certified and whose deps are all done.
 */
export function getNextReadyStories(batch) {
  return batch.stories.filter(s =>
    s.status === "certified" && isStoryReady(s, batch)
  );
}
