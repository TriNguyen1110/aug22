# Use cases

Docs folder is the brief agents read before touching code. Schema and API are frozen in
`../CONTRACT.md`. This file is the "why" and the concrete demo target — it does not change
mid-build.

## Demo target (revised 2026-08-22, was Notion/Linear/Asana)

- **Target company:** Anthropic (Claude)
- **Competitor:** OpenAI (ChatGPT/Codex)
- **Why the switch:** self-referential demo — a Claude marketing/product team researching its
  own reception, a real competitor, and the broader AI/agents discourse. Also strictly easier
  to demo: r/ClaudeAI, r/ChatGPTCoding, and r/singularity were already verified live via Bright
  Data's Direct API this session (real payloads, 150-180KB each), so there is zero new platform
  risk in the switch — same Reddit ingest path, different subreddit map. r/OpenAI and
  r/artificial were tried and returned empty/timed out; not used.
- Linear/Asana/co-google remain in the `companies` table as illustrative-only rows (seeded, not
  scraped) so `/competitors`' industry filter/sort still has more than two rows to demonstrate
  against — but they are not part of the live-data demo narrative anymore.

## Platform coverage (why this isn't "a few searches")

Reddit alone is exactly the kind of content a search engine or an LLM prompt can already
summarize — long-form public text is the least differentiated source available. The actual
value case is multi-platform breadth: signal a marketer cannot get from a few searches because
it isn't indexed as text anywhere, or sits behind a platform's own walled app.

- **Reddit** (`src/ingest/reddit.ts`) — all three use cases. Long-form quotable discourse,
  comments included, community name gives free audience segmentation.
- **Facebook** (`src/ingest/facebook.ts`) — competitor research primarily: Company Reviews and
  Group posts are genuinely multi-country and carry structured ratings, not just prose. Can
  double for monitoring via a brand's own Page posts.
- **Instagram** (`src/ingest/instagram.ts`) — monitoring primarily: a brand's own posts/Reels
  and the comments under them, which is the actual "how are people reacting to what we post"
  signal a search can't reconstruct (Instagram isn't crawled/indexed the way Reddit is).

All three follow the same shape: cache raw payload to `./data/raw/` before parsing, Zod-validate,
assert `records_extracted > 0` or fail loudly, OTel span per stage. `--cached` works identically
across all of them. Facebook/Instagram require Bright Data's Direct API (`BRIGHTDATA_API_TOKEN`,
Bearer auth) since their data comes from Bright Data's structured collector/dataset product, not
a raw page fetch through the Web Unlocker proxy — the proxy pattern that works for Reddit's
`.json` endpoints doesn't apply to JS-rendered platforms without their own API.

## Three pages, one schema

All three use cases write into the same `posts` / `findings` tables, distinguished by
`posts.source_type` and `findings.use_case`. No separate schema per page — that's the
one-day-build shortcut.

### 1. `/trends` — trend & insight research

Public discourse a simple search can't surface: burst detection on r/singularity (general
AI/agents/tech trend discourse — "AI slop", agentic coding, model releases, etc.).
`source_type = 'trend'`, `company_id = null`. Same burst-score SQL as the original design
(recent-window count / prior-window count, floored on absolute count). No model decides
what's trending — SQL does, the LLM only names and explains the term.

### 2. `/competitors` — competitor research

Real discourse about OpenAI (Codex/ChatGPT) from r/ChatGPTCoding — literally a subreddit where
people directly compare Claude Code and Codex, ideal competitor signal. `source_type =
'competitor'`, rows keyed to `companies.id = 'co-openai'`, `role = 'competitor'`. Structured
facts (LinkedIn company overview, pricing where public) land in `competitor_snapshots`;
discourse lands in `posts` like everything else.

### 3. `/monitoring` — own-company monitoring

Anthropic's own reception: r/ClaudeAI posts and reactions. `source_type = 'own'`,
`companies.id = 'co-anthropic'`, `role = 'target'`.

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
