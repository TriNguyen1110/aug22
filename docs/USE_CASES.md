# Use cases

Docs folder is the brief agents read before touching code. Schema and API are frozen in
`../CONTRACT.md`. This file is the "why" and the concrete demo target — it does not change
mid-build.

## Demo target

- **Target company:** Notion
- **Competitors:** Linear, Asana
- **Why these:** all three have active subreddits, public changelogs/blogs, and public pricing
  pages. No login walls, no app required to read. Reddit is the primary collector per
  `.claude/INSIGHTS.md`'s verified experiments.

## Three pages, one schema

All three use cases write into the same `posts` / `findings` tables, distinguished by
`posts.source_type` and `findings.use_case`. No separate schema per page — that's the
one-day-build shortcut.

### 1. `/trends` — trend & insight research

Public discourse a simple search can't surface: burst detection on r/Notion, r/SaaS,
r/productivity, r/Linear, r/asana. `source_type = 'trend'`. Same burst-score SQL as the
original design (recent-window count / prior-window count, floored on absolute count).
No model decides what's trending — SQL does, the LLM only names and explains the term.

### 2. `/competitors` — competitor research

Prices, changelog entries, and public activity for Linear and Asana, scraped from their
pricing pages, changelog/blog RSS, and their subreddits. `source_type = 'competitor'`,
rows keyed to a `companies` row with `role = 'competitor'`. Structured facts (a price, a
changelog line) land in `competitor_snapshots`; discourse about them lands in `posts` like
everything else.

### 3. `/monitoring` — own-company monitoring

Notion's own blog/changelog and its official social presence (r/Notion posts from
Notion-affiliated accounts, or just the subreddit as a proxy for "how people are reacting to
Notion's own posts"). `source_type = 'own'`, `companies.role = 'target'`.

## Grounding rule (unchanged)

Every `findings.quote` is a verbatim substring of `posts.text` for its `post_id`. Applies
identically across all three use cases. `npm run cite` checks all of them in one pass —
there's no per-use-case exemption.

## Credentials status (2026-08-22, build start)

Bright Data, Port, and SigNoz credentials are NOT yet wired. `.env.local` has empty
placeholders the user is filling in live while the build runs. Until a key lands:

- Ingest runs in `--cached` mode against whatever is in `./data/raw/`, or against seed data.
- Port/SigNoz calls are behind a feature check (`if (process.env.X)`) so the app runs and
  demos fine with zero sponsor keys, and lights up incrementally as keys land.
- Never block a build tick waiting on a key. Move to the next piece and come back.
