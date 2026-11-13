---
title: The coordinated release
description: How a team that works on one repository with kj agrees on a version before it is published, from kj release propose to kj release verify.
---

When several people work on one repository, each with their own agents, a release cut by one session alone surprises everyone else: their merged work goes out without them knowing, and nobody checks that their work in flight still fits. ADR 0057 makes a release a short, recorded agreement. Everyone with a part in it is asked, anyone can hold it, and a person signs before it is published.

## The idea in one paragraph

Someone proposes a version. kj opens a GitHub issue that lists what goes out, by author, and what stays out, by owner of each open pull request, and mentions all of them. Each of them answers from their own session, and their agent checks the candidate commit first. After 4 hours, silence counts as no objection; a hold always blocks. When the release is ready, a person of the signer roster approves it with their phone, and only then is the tag created. CI publishes nothing that is not approved.

## Who is asked

- **The authors of what goes out**: everyone with commits since the last tag. Merge commits do not count, since they name who merged, not who wrote.
- **The owners of the work in flight**: the author of every open pull request, so that they can check the candidate does not break what they are building.

Bots and authors without a GitHub account are listed in the issue but not asked: nobody can answer for them.

## Step by step

### 1. Propose

```sh
kj release propose 5.22.0
```

It opens the issue `Release 5.22.0` with the label `release`: the candidate commit (the current `HEAD`), the base tag, the deadline (4 hours from now, in UTC), what goes out and what stays out. The last line of the issue is a block that the next commands read; do not edit it by hand.

### 2. Answer

Each participant, from their own session:

```sh
kj release ack 4242 ok
kj release ack 4242 hold --why "the migration in #4230 must go first"
kj release ack 4242 include --include 4230
```

Every answer runs the compatibility check first: the full suite on the candidate commit, and the suite on the participant's own commits rebased onto it. Both run in temporary worktrees that are always removed, so your tree and your branch are never touched. The result travels with the answer.

- `ok` with a failing check is posted, but it counts as a hold: an ok that did not pass its own check is not an ok.
- An answer counts only from a participant, and only for the candidate the issue names.
- Your latest answer wins: you can hold and later say ok.

### 3. Look at the state

```sh
kj release status 4242
```

It says who confirmed, who holds and why, who has not answered and until when. It exits 1 while the release is not ready. A release is ready when nobody holds it and everyone answered, or the 4 hours have passed.

### 4. Approve

```sh
kj release approve 4242
```

This is a human act: kj refuses it in an agent's session, and it asks for your signature on your phone, with a passkey or a key of the signer roster. Before signing it checks that the release is ready; after signing it reads the issue again and stops if someone held it meanwhile. Then it posts the signed approval on the issue, tags the candidate as `v5.22.0` and pushes the tag.

### 5. Publish

The tag starts the release workflow. Before publishing, it runs:

```sh
kj release verify v5.22.0
```

It passes only when the tag is on `main`, there is exactly one release issue for that version, the tag points to its candidate, the release is still ready (a hold posted after the approval also stops it), and the approval is signed by someone of the roster. Anything else stops the publish and says why.

## A repository with one person

Nothing gets in the way: you are the only participant, you answer, and you approve.

## What it does not replace

The approval of the `npm-publish` environment on the run, if your repository has one, stays as an extra layer. The coordinated release decides whether a version should go out; the environment decides whether this run may use the publishing credentials.
