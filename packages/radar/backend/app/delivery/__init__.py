"""Getting analysed signals to the people who asked for them.

The tree already separates the flow by direction: ``connectors`` is where
material comes in, ``services`` is where it is analysed, and this is where
it goes out. Delivery lives here.

## Which half of the configuration belongs where

Delivery is configured from two places, and the line between them is not
about secrecy alone -- it is about what a change means.

**The Radar Profile** carries what a domain expert would change: how good a
signal has to be before it is worth interrupting someone, how many items a
digest should carry, which languages it goes out in, which sections it has.
Changing any of those is a judgement about the domain, it wants reviewing,
and it should travel with the profile that defines the instance.

**The environment** carries what an operator would change: the webhook URL,
the recipients, credentials. Those are specific to one deployment, several
of them are secrets, and none belongs in a repository.

The test for a new setting: would you want it in a pull request, or would
you be alarmed to find it there?

> **Not there yet.** Some domain-side settings currently live in the
> ``configuration`` table rather than in the profile -- a score threshold, a
> digest size, an output language that duplicates the profile's own
> ``summary.languages``. Moving them is KRD-TSK-0011; this note records the
> intended line so the drift is visible rather than assumed.
"""
