// Shared test fixtures for agent constructors. Six agent test files
// declared the same `{ roles, coder_options, reviewer_options }` shape
// inline (audit by KJC-TSK-0502). Use the factory when spreading the
// config inside a test (`...baseAgentConfig()`) so each call returns a
// fresh object and tests cannot accidentally cross-contaminate.

export const baseAgentConfig = () => ({
  roles: { coder: {}, reviewer: {} },
  coder_options: {},
  reviewer_options: {}
});
