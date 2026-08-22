# Contract

Frozen at build start. Both build agents read this. Neither edits it.
If it must change, the main session changes it and says so out loud.

Read `docs/USE_CASES.md` first for the why and the demo target (Notion vs Linear/Asana).

## Schema

SQLite, file at `./data/app.db` (path from `DB_PATH` env, default `./data/app.db`).

```
companies
  id           text primary key
  name         text
  domain       text
  role         text         -- 'target' | 'competitor'

posts
  id           text primary key
  company_id   text references companies(id), nullable
  source_type  text         -- 'trend' | 'competitor' | 'own'
  platform     text
  author       text
  url          text
  text         text
  posted_at    text         -- ISO 8601
  fetched_at   text         -- ISO 8601

trends
  id           text primary key
  term         text
  recent_count int
  prior_count  int
  score        real         -- recent/prior, floored on absolute count
  window_start text         -- ISO 8601
  window_end   text         -- ISO 8601

findings
  id           text primary key
  post_id      text references posts(id)
  trend_id     text references trends(id), nullable
  company_id   text references companies(id), nullable
  use_case     text         -- 'trends' | 'competitor' | 'monitoring'
  claim        text
  quote        text         -- MUST appear verbatim in posts.text
  category     text
  confidence   real

competitor_snapshots
  id           text primary key
  company_id   text references companies(id)
  item_type    text         -- 'price' | 'update' | 'activity'
  label        text
  value_text   text
  url          text
  captured_at  text         -- ISO 8601
```

## API

```
GET /api/health                    -> { ok, records_extracted, last_ingest_at }
GET /api/trends                    -> { trends: Trend[] }                 ranked by score desc
GET /api/trends?q=<term>           -> { query, matched_posts, trends: Trend[], findings: Finding[], posts: Post[] }
                                       real-time burst detection scoped to posts whose text
                                       matches <term> (case-insensitive substring, any
                                       source_type). Computed on the fly, not written to the
                                       `trends` table (that table stays the global unscoped
                                       view). findings/posts here are generated at request time
                                       from the matching subset, not pre-seeded — findings.quote
                                       still MUST be a verbatim substring of the cited post's
                                       text. matched_posts is the honest total before ranking;
                                       0 means say so, never fabricate a result.
GET /api/trends/:id                -> { trend, findings, posts }
GET /api/competitors                -> { companies: Company[], snapshots: CompetitorSnapshot[] }
GET /api/competitors/:id           -> { company, snapshots, findings, posts }
GET /api/monitoring                -> { posts: Post[], findings: Finding[] }   source_type='own'
```

## Invariants

- `findings.quote` is a verbatim substring of `posts.text` for its `post_id`. No paraphrase.
- `records_extracted > 0` after any ingest, or the run failed regardless of HTTP status.
- Every number shown in the UI is reproducible from a query.
- Detection is SQL. No model call decides what is trending.
- Sponsor calls (Port, SigNoz) are optional at runtime: guard on `process.env.X` presence so
  the app and tools work with zero sponsor keys and light up as keys land in `.env.local`.

## Ownership

```
app/**, components/**      frontend agent
src/ingest/**              backend agent
src/detect/**              backend agent
src/api/**                 backend agent
src/db/**                  backend agent
CONTRACT.md                main session only
```
