# Contract

Frozen at H+1 on event day. Both build agents read this. Neither edits it.
If it must change, the main session changes it and says so out loud.

## Schema

```
posts
  id           text primary key
  platform     text
  author       text
  url          text
  text         text
  posted_at    timestamptz
  fetched_at   timestamptz

trends
  id           text primary key
  term         text
  recent_count int
  prior_count  int
  score        numeric      -- recent/prior, floored on absolute count
  window_start timestamptz
  window_end   timestamptz

findings
  id           text primary key
  post_id      text references posts(id)
  trend_id     text references trends(id)
  claim        text
  quote        text         -- MUST appear verbatim in posts.text
  category     text
  confidence   numeric
```

## API

```
GET /api/trends                  -> { trends: Trend[] }        ranked by score desc
GET /api/trends/:id              -> { trend, findings, posts }
GET /api/health                  -> { records_extracted, last_ingest_at, ok }
```

## Invariants

- `findings.quote` is a verbatim substring of `posts.text` for its `post_id`. No paraphrase.
- `records_extracted > 0` after any ingest, or the run failed regardless of HTTP status.
- Every number shown in the UI is reproducible from a query.
- Detection is SQL. No model call decides what is trending.

## Ownership

```
app/**, components/**      frontend agent
src/ingest/**              backend agent
src/detect/**              backend agent
src/api/**                 backend agent
CONTRACT.md                main session only
```
