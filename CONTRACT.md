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
  industry     text nullable
  market_share real nullable   -- illustrative percentage, not audited
  size         text nullable   -- e.g. 'startup' | 'mid-market' | 'enterprise'
  niche        text nullable

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
  item_type    text         -- 'price' | 'update' | 'activity' | 'profile'
  label        text
  value_text   text
  url          text
  captured_at  text         -- ISO 8601
```

`item_type = 'profile'` is a real, grounded company description pulled from the company's public
LinkedIn overview page (`src/ingest/linkedin.ts`) — this is what should back `companies.niche`
in the UI going forward instead of the illustrative seed value. Any `companies.market_share`/
`size`/`niche` value that does NOT have a corresponding real `competitor_snapshots` row backing
it is illustrative seed data, not scraped — the UI MUST badge it as an estimate (e.g. "Est.")
rather than presenting it with the same visual weight as grounded data. This is the fix for the
"where does this 27.4% come from" credibility gap: never let a fabricated number look as
authoritative as a cited one.

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
GET /api/trends/:id                -> { trend, findings, posts, timeline: Array<{ date, count }> }
                                       timeline is a daily count of matching posts across the
                                       trend's window (window_start..window_end), computed from
                                       real posted_at timestamps — powers a sparkline, not a
                                       new stored table. Zero-filled for days with no posts, not
                                       omitted, so the UI can render a continuous line.
GET /api/competitors                -> { companies: Company[], snapshots: CompetitorSnapshot[] }
GET /api/competitors?industry=&sort=<market_share|size|name>
                                    -> same shape, companies filtered/sorted server-side.
                                       Both params optional; no params = current unfiltered
                                       behavior, unchanged. sort defaults to name asc.
GET /api/competitors?q=<term>      -> { query, matched_companies, companies: Company[],
                                         snapshots: CompetitorSnapshot[] }
                                       Scoped price/activity search: matches companies whose
                                       name/niche contains <term>, or snapshots whose label/
                                       value_text contains <term> (e.g. "enterprise", "$",
                                       a plan name). Case-insensitive substring, computed on
                                       the fly. matched_companies is the honest total; 0 means
                                       say so, empty arrays, never fabricate a result. Composes
                                       with industry/sort (all three are independent optional
                                       params, industry/sort still apply to the q-filtered set).
GET /api/competitors/:id           -> { company, snapshots, findings, posts }
GET /api/monitoring                -> { posts: Post[], findings: Finding[] }   source_type='own'
POST /api/chat
  body: { question: string }
  -> { answer: string,
       citations: Array<{ post_id, quote, url }>,
       brightdata: { attempted: boolean, ok: boolean, records_extracted: number, error?: string } }
  Attempts a live Bright Data fetch relevant to the question (best-effort keyword extraction
  against the question text, reusing the Direct API ingest path in src/ingest/reddit.ts) before
  answering, since the user explicitly wants live-per-question fetches over cached-only. If
  Bright Data fails or returns nothing, `brightdata.ok` is false / `records_extracted` is 0 —
  say so honestly in `attempted`/`ok`, do not silently fall back without disclosing it. The
  answer is generated by an LLM call (ANTHROPIC_API_KEY) constrained to ONLY the retrieved real
  post quotes (existing DB + anything freshly ingested this request) — every `citations[].quote`
  MUST be a verbatim substring of its `post_id`'s text, same grounding rule as `findings`. The
  model explains/summarizes; it never invents a fact not present in a cited quote. If no posts
  are relevant, `answer` says so plainly and `citations` is empty — never fabricate an answer.
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
