# The HU Board hides a project whose directory no longer exists

Status: accepted
Date: 2026-11-17

## Context

Issue 4394: board projects whose directory is gone stay in the database and in the project list forever. The issue asked for the decision to be an ADR: hide them or garbage-collect them on sync.

## Decision

Decided by the maintainer on 2026-11-17: hide them. The board records the directory of each project when it syncs its plans, and the project list leaves out a project whose recorded directory does not exist. Nothing is deleted: its cards stay, and it is listed again when the directory comes back. A project with no recorded directory stays listed.

## Consequences

A directory that moved for good leaves its rows in the database; deleting a project stays the explicit action it already is. A project hidden from the list is still reachable through its own endpoints.
