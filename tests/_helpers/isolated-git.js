// An environment for git in a throw-away repo: it ignores the developer's global and
// system config (commit.gpgsign, tag.gpgsign, commit templates, core.hooksPath, ...).
export const isolatedGitEnv = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
});
