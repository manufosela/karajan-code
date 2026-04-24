/**
 * Tiny pub/sub used to push sync-related events to connected SSE
 * clients. The chokidar watcher calls `publish(event)` whenever a plan
 * / session / batch file changes; the SSE endpoint subscribes each
 * connected response and writes the JSON-encoded event as a message.
 *
 * No external dependency on purpose — `events.EventEmitter` would work
 * but would make testing the endpoint awkward (we need deterministic
 * subscribe/publish semantics for the integration tests in
 * sse.test.js). The contract is:
 *
 *   subscribe(fn)   → returns an unsubscribe function
 *   publish(event)  → calls every current subscriber once
 *   subscriberCount → how many listeners are live (tests only)
 *
 * Events are plain JSON objects. Callers pick the shape:
 *
 *   { type: 'plan',    planId, projectId }   — a plan JSON was synced
 *   { type: 'session', sessionId, projectId }— a session JSON was synced
 *   { type: 'story',   storyId, projectId }  — a single HU row mutated
 *
 * The board's client treats these as hints: the usual response is to
 * re-fetch the affected project's stories and patch the kanban in
 * place, so no full page reload is ever required.
 */

const subscribers = new Set();

/**
 * @param {(event: object) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/**
 * @param {object} event
 */
export function publish(event) {
  for (const fn of subscribers) {
    try { fn(event); } catch (err) {
      // A broken subscriber must not take the bus down. Log and move on.
      console.error('[event-bus] subscriber threw:', err.message);
    }
  }
}

/** @returns {number} */
export function subscriberCount() {
  return subscribers.size;
}

/** Test helper — drops every subscriber. */
export function _resetForTests() {
  subscribers.clear();
}
