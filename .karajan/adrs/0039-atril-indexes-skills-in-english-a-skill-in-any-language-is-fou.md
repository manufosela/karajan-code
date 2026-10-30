# atril indexes skills in English; a skill in any language is found through English metadata

Status: accepted
Date: 2026-10-29 (accepted 2026-11-01)

## Context

atril's search is lexical (`packages/atril/src/search.js`, `SEARCH_MODE` lexical):
- tokens are lowercased whole words;
- accents are not folded;
- there is no stemming;
- enrich's stopwords are English only;
- a query in one language never matches a skill written in another.

So a Spanish query does not find an English skill, and `busqueda` does not find `búsqueda`.

Who searches matters here. Almost every query is written by an agent (the `/atril` bridge, the router rule, kj's `resolve`), not by a person. Almost every skill (addyosmani, Anthropic, marketplaces, the recommended set) is in English. Skills in other languages are mostly a team's own.

ADR 0021 plans QMD as an optional backend and says atril calls no model on its own. The QMD spike spec (#2733) found QMD heavy for atril:
- native dependencies;
- 300 MB–2 GB of models;
- an async SDK;
- a default embedding model that its own README calls English-optimized.

## Decision

English is the language of the index. A skill may be written in any language, because the agent reads it in that language. To be found, it carries an English description in `atril.en` and English `atril.keywords`.

1. **English metadata.** The consumer's enricher (Karajan, through its agents) writes the English description (in `atril.en`) and keywords of a skill in another language, once, at import or enrich time. atril calls no model. `atril enrich` and the import warn when a skill's metadata is not in English.
2. **Queries in English, answers in the asker's language.** The router rule tells the agent to query atril in English; the agent reads the results itself. `kj skills search` translates both ways: a person's query into English before it reaches atril, and the results back into that person's language. A person who asks in Spanish always gets an answer, with no second index.
3. **No silent miss where nobody translates.** Only `atril search` run on its own (no kj, no agent) has no translator, because atril calls no model. There, when it finds nothing and the query looks non-English (accented letters or common Spanish stopwords), it says that the index is in English and suggests English terms or `kj skills search`.
4. **Cheap lexical help that works in any language.**
   - One shared `fold()` (lowercase, NFD, strip combining marks) for search and enrich.
   - A prefix match: a query term of 4+ characters that is a prefix of a field token scores below an exact match.

A semantic backend (QMD or a small multilingual embedder) stays optional, off by default and an explicit opt-in. It comes in only if the #2733 spike shows that it passes and that it beats the layers above.

Alternatives considered:
- **Translate the skill and index only the translation.** A Spanish query would then miss it, every query would need a model, and rewriting the skill would mark it `edited` against its lock hash.
- **A bilingual index** (metadata in both languages, Spanish stopwords, queries in any language). It costs more code and tests. It stays possible later as a superset: add the second language's metadata, nothing is rebuilt.
- **QMD as the default index.** Too heavy, async, and it breaks the "no model" rule.
- **kaRAGan's embedder.** atril may not depend on the family, and kaRAGan is AGPL.

## Consequences

- Store content and ranking stay deterministic, synchronous and free of dependencies, and atril still calls no model.
- A skill without English metadata is hard to find, and atril says so.
- A person who types a Spanish query into `atril search` on its own gets a hint, not a hit; through `kj skills search` the same query gets results in Spanish.
- Card changes:
  - Spanish stopwords and `atril.lang` (HU-2730) are dropped.
  - The enricher card (HU-2732) writes the English description (in `atril.en`) and keywords.
  - A new card covers the router rule, the import warning and the no-hit hint.
  - Translation both ways in `kj skills search` is a kj-side card.

Decided by the maintainer (2026-11-01):
- `ñ` folds to `n` along with the accents; the shared `fold()` (NFD, combining marks stripped) already does it.
- ADR 0021's "no model" rule stays. Whether to amend it is decided only if a semantic backend passes the #2733 spike, with its data.
