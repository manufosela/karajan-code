# Logical clocks & happened-before (Lamport, 1978)

## Problem signature

Events across processes/services need a consistent order, and wall clocks
disagree: "last write wins" flip-flops between replicas, audit logs interleave
impossibly, a consumer sees an update before the create it depends on.

## Reach for it when

- Two or more writers/emitters produce events whose CAUSAL order matters
  (A caused B must never be observed as B before A).
- You are tempted to "fix it with NTP" or timestamps — clock skew makes
  timestamp ordering a race, not an order.
- You need to detect concurrent (conflicting) updates, not just order them:
  that is the vector-clock extension (one counter per node; compare
  component-wise; incomparable = concurrent — see Dynamo's usage).

## Do NOT reach for it when

- A single writer (or a single database) already totally orders the events —
  its sequence/autoincrement/WAL IS the clock. Most CRUD apps live here.
- You only need "roughly recent first" for humans (feeds, logs for reading):
  wall-clock timestamps are fine and far simpler.
- You need a TOTAL order agreed by all nodes: logical clocks give a partial
  causal order; total order needs consensus (Raft/Paxos) or a sequencer.

## Trade-offs

- Lamport clocks are one counter: tiny, but they cannot tell concurrent from
  ordered. Vector clocks can, at O(nodes) metadata per event that must be
  carried, stored and pruned.
- Causality tracking pushes conflict RESOLUTION to the reader (semantic
  merge, CRDTs, or ask-the-user) — ordering was the easy half.

## Canonical source

Leslie Lamport, "Time, Clocks, and the Ordering of Events in a Distributed
System", Communications of the ACM, 1978. The happened-before relation and
the clock condition come verbatim from it.
