# Creating an instance

An **instance** is one deployed radar watching one domain: an orthodontics
research radar, a shared-mobility and energy-policy radar, whatever comes next.

**Do not fork this repository to create one.** A fork is two copies that
diverge, and keeping them in step by hand is the exact problem this codebase
was restructured to remove. An instance consumes the core; it does not copy it.

---

## What belongs to whom

| Artefact | Owner | Why |
|---|---|---|
| Application code, pipeline, generic connectors | **core** (this repo) | Identical for every instance |
| Radar Profile (`<id>.yaml`) | **instance** | Defines the domain |
| Source-specific connectors (BOE, PubMed, a regulator's API) | **instance** | Only that domain needs them |
| Protocol connectors (RSS/Atom) | **core** | Any domain can point them anywhere |
| API keys, database credentials, webhook URLs | **instance** | Secrets, never in any repository |
| Deployment config (Cloud Run, Cloud SQL, scheduler) | **instance** | Its own project and billing |
| Branding (name, tagline, organisation) | **instance** | Build arguments |
| Delivery thresholds, digest size, languages, sections | **instance**, in the profile | Domain judgement; belongs under review |
| Webhook URLs, recipients | **instance**, in the environment | One deployment's own, some of them secrets |

Delivery splits across the last two rows, and the line is not only about
secrecy. Ask what a change *means*: how good a signal has to be before it
interrupts someone is a judgement about the domain, and you want it in a pull
request. A webhook URL is one deployment's own, and you would be alarmed to
find it in one. The first kind goes in the profile, the second in the
environment.

The rule of thumb for a connector: **a connector that knows a protocol belongs
to the core; a connector that knows an organisation belongs to the instance.**
`rss` reads any feed, so it is core. A BOE connector knows the structure of one
country's official gazette — it is of no use to a dentistry radar, and putting
it in the core would make every instance carry it.

> The core currently ships PubMed, arXiv, CrossRef, Semantic Scholar and
> ClinicalTrials, which only serve scientific domains. That predates this rule
> and is inconsistent with it. They stay for now because moving them is a
> breaking change for the orthodontics instance; new source-specific connectors
> should not join them.

---

## The instance repository

Create a repository holding **only** the instance's own artefacts:

```
tribbu-radar/                    # example instance repo — no application code
├── profiles/
│   └── mobility-energy.yaml     # the domain definition
├── connectors/                  # optional: source-specific connectors
│   └── boe.py
├── deploy/
│   ├── cloudrun.yaml            # or terraform/, pulumi/, whatever you use
│   └── scheduler.yaml
├── .env.example                 # names of the variables, never their values
└── README.md                    # how to deploy this instance
```

It depends on the core as a published container image, not as source.

---

## Steps

### 1. Write the Radar Profile

Copy `backend/profiles/mobility-energy.yaml` from the core as a starting point
and edit the domain: `organization`, `taxonomy`, `vocabulary`, `sources`,
`branding`. Leave `prompts` out unless the defaults genuinely do not fit — they
render every definition from the taxonomy above them.

Validate it before deploying anything:

```bash
ACTIVE_PROFILE=<id> PROFILES_DIR=/path/to/profiles \
  uv run python -c "from app.profiles.active import get_active_profile; \
    p = get_active_profile(); print(p.id, len(p.taxonomy.themes), 'themes')"
```

A malformed profile fails here rather than producing degraded classifications
weeks later: weights must sum to 1.0, ids must be unique, and every prompt
variable must be both declared and used.

### 2. Point the instance at it

| Variable | Value |
|---|---|
| `ACTIVE_PROFILE` | The profile id, matching its filename |
| `PROFILES_DIR` | Where the instance's profiles are mounted |
| `DATABASE_URL` | The instance's own database |
| `APP_SECRET_KEY` | Required, no default |
| `ALLOWED_ORIGINS` | The instance's own hostnames |
| `SCHEDULER_JOB_NAME` | Fully qualified Cloud Scheduler job, or unset |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | First admin account; unset seeds none |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OLLAMA_BASE_URL` | Per the profile's `llm.provider` |

Mount the profiles directory into the container and set `PROFILES_DIR` to it —
a volume, a config map, or a Secret Manager mount. The profile is configuration,
not code.

### 3. Build the frontend with its branding

Next.js inlines `NEXT_PUBLIC_*` at build time, so branding is a **build
argument**, not a runtime variable:

```bash
gcloud builds submit frontend \
  --substitutions=_PROJECT=<gcp-project>,_API_URL=https://<api-host>/api/v1,\
_APP_NAME="Shared Mobility Radar",_APP_SHORT_NAME="Mobility Radar",\
_ORGANIZATION_NAME="<organisation>"
```

### 4. Deploy

Backend and frontend are Cloud Run services; ingestion and digests are Cloud
Run Jobs on a Cloud Scheduler trigger. See
[architecture.md](architecture.md) for the full topology. Run the migrations
against the instance's database before first use.

### 5. Verify before declaring it live

- The profile loads and the expected themes appear at `GET /api/v1/configuration/profile`
- One ingestion run completes and the `ingestion_runs` row reports per-source results
- A handful of items get classified into the profile's own themes, not somebody else's

---

## Adding a source-specific connector

Subclass `BaseConnector` in the instance repository and implement `fetch`,
`parse` and `normalize`, returning `NormalizedPaper` objects. Use
`document_type="strategic_signal"` for anything that is not a research paper.

Follow what `app/connectors/rss.py` does about failure: degrade per item and
per source, and surface a dead source in the run result. A connector that
silently returns nothing is indistinguishable from a quiet week.

> **Not yet supported:** the registry (`app/connectors/registry.py`) registers
> connectors by name but only discovers the ones bundled in the core. Loading a
> connector from outside the repository needs an extension point that does not
> exist yet — until it does, a source-specific connector has to be contributed
> to the core. This is the main thing standing between the current state and a
> clean instance model.

---

## For agents

If you are an agent asked to create an instance:

1. **Never fork this repository, and never copy `backend/` or `frontend/` into
   the instance repo.** If a task seems to require it, that is the signal to
   stop and ask.
2. **Ask before assuming these**, because guessing wrong is expensive:
   - Which GCP project and region, and whose billing account
   - Where the profile lives (instance repo, Secret Manager, config map)
   - Whether the domain needs sources beyond RSS, which means a connector
   - Which LLM provider, since it changes the cost profile entirely
3. **Never put a customer's name, hostname, project id or email in the core
   repository.** That is what `ALLOWED_ORIGINS`, `SCHEDULER_JOB_NAME` and the
   Cloud Build substitutions are for. The core's own profiles use generic
   organisation names on purpose.
4. **Work the Planning Game normally**: a card before touching anything, one
   branch per card, a PR that merges before the next task starts.
5. **Validate the profile locally before deploying.** Do not discover a
   malformed profile from a Cloud Run crash loop.
