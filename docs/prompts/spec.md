# Writing a spec for Karajan

You do not need a formal document. Answering this gives Karajan enough to plan
without guessing:

- **The problem.** What hurts today and for whom. One or two sentences.
- **What you want to be able to do when it is finished.** Describe it as
  something observable ("a visitor can book and get a confirmation"), not as a
  feature list.
- **Real constraints.** Deadline, budget, where it has to run, which systems it
  lives with, what is off limits.
- **Non-goals.** What you are not building now; it keeps the agent from drifting.
- **What you are happy to let Karajan decide.** If you have no opinion on the
  stack or the architecture, say so: it will propose options and leave them as
  an ADR for you to approve, instead of asking you about everything.

A minimal example:

> Problem: my salon's clients book over WhatsApp and my appointments overlap.
> When done: a client picks a service, sees real openings and books; I see the
> day's schedule.
> Constraints: web, mobile first, no licence costs, in production in 3 weeks.
> Non-goals: online payments, a loyalty program.
> I don't mind: the framework, as long as it stays maintainable.

The clearer the "when done" and the "non-goals", the fewer loops Karajan takes.

When you are ready, paste [brief.md](https://karajancode.com/brief.md) into your
agent and answer its questions.
