# Task manager template

Copy this folder, rename the package (`kj-board-<name>`), and replace the client calls in
`src/manager.js` with calls to your service. The rules to keep are in the comments.

- `src/manager.js`: the four operations, the optional parts, the three errors.
- `src/index.js`: `createManager({ config, env, run })`, the uniform entry.
- The test that runs the shared suite (`runStoryContract`) against a fake in-memory service is
  `tests/hu/manager-template.test.js` of karajan-code; copy it next to your manager and point the
  import at your `src/index.js`.

Read the guide first: `docs/TASK-MANAGERS.md`.
