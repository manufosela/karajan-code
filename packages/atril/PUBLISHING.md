# Publishing a version of atril

This file is not in the `files` list of `package.json`, so it stays out of the tarball.

## How a release works

- The version bump is its own commit. It changes only `packages/atril/package.json` and the atril entry of `package-lock.json` (see `git log --oneline -3 -- packages/atril/package.json`).
- Merging that commit publishes nothing.
- `.github/workflows/release-npm.yml` publishes kj (tags `v*`), not atril. There is no atril tag.
- atril is published by hand by the maintainer, with a one-time password.
- An agent session does not log in or publish.

## Steps

Run everything from `packages/atril`, on `main` after the bump is merged.

1. `npm pack --dry-run`. The first line must say `@karajan-family/atril@<version>`.
2. `npm login`. It opens the browser.
3. `npm publish --access public --otp=<code>`.
4. `npm view @karajan-family/atril version`. The registry can take a few minutes to show the new version.

## Mistakes seen

- `npm pack --prefix packages/atril` from the repo root still packs kj. Run it from `packages/atril`.
- With no npm session, `npm whoami` gives 401 and `npm publish` gives 404. Run `npm login` first.
- A shell that cannot ask for input fails with `EOTP`. Pass the code in `--otp`.
